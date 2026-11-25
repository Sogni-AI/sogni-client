'use strict';
/**
 * `mediaEncryption: 'auto'` with managed keys, through a real
 * SogniClient: REST over a stubbed fetch, the socket over a local WebSocket
 * server.
 *
 * - Left unset, nothing a caller gets changes: no key request, no capability
 *   header or handshake parameter, no `mediaEncryption` on jobs, plaintext
 *   uploads.
 * - 'auto' changes nothing either until a connection reports
 *   `mediaEncryptionAvailable: true`: no key request, no header, no handshake
 *   parameter, no in-band message.
 * - Once available it fetches the key, declares `ciphertext-v1` on REST and
 *   in-band on the open socket (and at the handshake of later connections),
 *   and encrypts eligible jobs; the recipient record opens with an
 *   independent implementation. When availability ends it stops encrypting
 *   and keeps the key for reading.
 * - A 503 (ErrorCodes.SERVICE_UNAVAILABLE, 135), or any failure, sends plain,
 *   logs, and asks again after 5 minutes or at the next sign-in. A slow key
 *   server holds a new project for at most 5 seconds.
 */
const assert = require('node:assert/strict');
const { createDecipheriv, hkdfSync, randomBytes } = require('node:crypto');
const { WebSocketServer } = require('ws');
const { SogniClient } = require('../dist/index.js');
const lib = require('../dist/lib/mediaEncryption/index.js');

const REST = 'https://api.media-auto.test';
const STORAGE = 'https://storage.media-auto.test/presigned';
const API_KEY = 'check-media-encryption-auto';
const CAPABILITY_HEADER = 'x-sogni-media';
const WALLET = '0x00000000000000000000000000000000000000a1';

const bytesOf = async (body) =>
  new Uint8Array(body instanceof Blob ? await body.arrayBuffer() : Buffer.from(body));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(condition, label, timeoutMs = 10000) {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await sleep(10);
  }
}
function pattern(length, seed = 3) {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = (i * 31 + seed) & 0xff;
  return out;
}

/** Opens a recipient record independently of the SDK. */
function unwrapStanzaWithNodeCrypto(accountKey, stanza) {
  const checkSecret = Buffer.from(
    hkdfSync('sha256', accountKey, 'sogni-media-encryption', 'key-check-secret-v1', 32)
  );
  const nonce = Buffer.from(stanza.subarray(9, 21));
  const keyCheck = Buffer.from(hkdfSync('sha256', checkSecret, nonce, 'key-check-v1', 8));
  assert.equal(stanza[0], 1, 'stanza version 1');
  assert.deepEqual(Buffer.from(stanza.subarray(1, 9)), keyCheck, 'keyCheck per the contract');
  const wrapped = Buffer.from(stanza.subarray(21));
  const decipher = createDecipheriv('aes-256-gcm', accountKey, nonce);
  decipher.setAAD(Buffer.from('sogni-media-recipient-v1'));
  decipher.setAuthTag(wrapped.subarray(32));
  return new Uint8Array(Buffer.concat([decipher.update(wrapped.subarray(0, 32)), decipher.final()]));
}

const MODELS = [
  {
    id: 'encryptable-model',
    name: 'Encryptable',
    SID: 1,
    tier: 'image-tier',
    media: 'image',
    supportsMediaEncryption: true
  },
  { id: 'plain-model', name: 'Plain', SID: 2, tier: 'image-tier', media: 'image' },
  {
    id: 'inputs-as-they-are-model',
    name: 'Encrypted results, plain inputs',
    SID: 3,
    tier: 'image-tier',
    media: 'image',
    supportsMediaEncryption: true,
    mediaEncryptionInputs: false
  }
];
const range = { min: 1, max: 50, default: 20, decimals: 0 };
const TIERS = {
  'image-tier': {
    benchmark: { sec: 1, secCN: 1, secMaxPreviews: 1 },
    steps: range,
    guidance: range,
    scheduler: { allowed: ['simple'], default: 'simple' },
    sampler: { allowed: ['euler'], default: 'euler' }
  }
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function keyResponse(current, previous = []) {
  return json({
    status: 'success',
    data: {
      version: 1,
      current: { id: 'mk1_000000000001', key: Buffer.from(current).toString('base64'), createdAt: 1 },
      previous: previous.map((key, index) => ({
        id: `mk1_00000000000${index + 2}`,
        key: Buffer.from(key).toString('base64'),
        retiredAt: 1
      }))
    }
  });
}
// The key endpoint's answer when keys are temporarily unavailable: ErrorCodes.SERVICE_UNAVAILABLE.
const unavailable = () =>
  json({ status: 'error', errorCode: 135, message: 'Service Unavailable' }, 503);

/**
 * One signed-in client against a fresh socket server. `mediaKey` answers each
 * `GET /v1/account/media-key` (it is called with the attempt number).
 */
async function startSession({
  mode,
  mediaKey,
  available = true,
  disableSocket = false,
  network,
  declareMediaCapability
}) {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise((resolve) => server.on('listening', resolve));
  const connections = [];
  const frames = [];
  server.on('connection', (ws, req) => {
    const connection = connections.length;
    connections.push(new URL(req.url, 'ws://127.0.0.1'));
    ws.on('message', (raw) => {
      const frame = JSON.parse(raw.toString());
      frames.push({
        connection,
        type: frame.type,
        data: JSON.parse(Buffer.from(frame.data, 'base64').toString('utf8'))
      });
    });
    const payload = {
      address: WALLET,
      username: 'artist',
      mediaEncryptionAvailable: available,
      hasUnclaimedAirdrop: false,
      firstLoginAfterMigration: false
    };
    ws.send(
      JSON.stringify({
        type: 'authenticated',
        data: Buffer.from(JSON.stringify(payload)).toString('base64')
      })
    );
  });
  const requests = [];
  let keyAttempts = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const headers = Object.fromEntries(
      Object.entries(init.headers || {}).map(([name, value]) => [name.toLowerCase(), value])
    );
    requests.push({ url, path: url.pathname, method: init.method || 'GET', headers, body: init.body });
    if (url.href.startsWith(STORAGE)) return new Response(null, { status: 200 });
    switch (url.pathname) {
      case '/v1/account/media-key':
        return mediaKey(++keyAttempts);
      case '/api/v1/models/list':
        return json(MODELS);
      case '/api/v2/models/tiers':
        return json(TIERS);
      case '/v1/assets/capabilities':
        return json({ status: 'success', data: { enabled: false } });
      default:
        return json({ status: 'success', data: { uploadUrl: STORAGE } });
    }
  };
  const warnings = [];
  const logger = { debug() {}, info() {}, warn: (...args) => warnings.push(args), error() {} };
  const sogni = await SogniClient.createInstance({
    appId: 'check-media-encryption-auto',
    apiKey: API_KEY,
    restEndpoint: REST,
    socketEndpoint: `ws://127.0.0.1:${server.address().port}`,
    logger,
    ...(disableSocket ? { disableSocket } : {}),
    ...(network ? { network } : {}),
    ...(declareMediaCapability !== undefined ? { declareMediaCapability } : {}),
    ...(mode !== undefined ? { mediaEncryption: mode } : {})
  });
  if (!disableSocket) {
    await waitFor(() => sogni.apiClient.socket._authenticatedSocket, 'socket authentication');
  }
  return {
    sogni,
    connections,
    frames,
    requests,
    warnings,
    keyRequests: () => requests.filter((request) => request.path === '/v1/account/media-key'),
    declarations: () => frames.filter((frame) => frame.type === 'mediaCapability'),
    declaredRest: () => requests.filter((r) => CAPABILITY_HEADER in r.headers),
    jobRequests: () => frames.filter((frame) => frame.type === 'jobRequest').map((f) => f.data),
    uploads: () => requests.filter((request) => request.method === 'PUT'),
    async create(params = {}) {
      const before = frames.length;
      const project = await sogni.projects.create({
        type: 'image',
        modelId: 'encryptable-model',
        positivePrompt: 'a lighthouse',
        numberOfMedia: 1,
        steps: 20,
        guidance: 7,
        startingImage: new Blob([pattern(3000)], { type: 'image/png' }),
        ...params
      });
      await waitFor(
        () => frames.slice(before).some((frame) => frame.type === 'jobRequest'),
        'jobRequest'
      );
      return { project, request: frames.slice(before).find((f) => f.type === 'jobRequest').data };
    },
    /** Drop every open connection, as a network blip does; the client reconnects. */
    drop() {
      for (const ws of server.clients) ws.terminate();
    },
    /** Send a frame to every open connection, as the server does. */
    push(type, data) {
      for (const ws of server.clients) {
        ws.send(
          JSON.stringify({ type, data: Buffer.from(JSON.stringify(data)).toString('base64') })
        );
      }
    },
    async close() {
      sogni.dispose();
      globalThis.fetch = realFetch;
      await new Promise((resolve) => server.close(resolve));
    }
  };
}

const queryNames = (url) => [...url.searchParams.keys()].sort();

/** Left unset: every surface is what an earlier SDK produced. */
async function checkDefaultIsUnchanged() {
  // Everything that would make 'auto' encrypt is in place; only the option is missing.
  const session = await startSession({ mediaKey: () => keyResponse(randomBytes(32)) });
  try {
    assert.equal(session.sogni.mediaEncryption.available, true);
    const { project, request } = await session.create();
    assert.equal(session.keyRequests().length, 0, 'no key is requested');
    assert.equal(
      session.requests.some((r) => CAPABILITY_HEADER in r.headers),
      false,
      'no REST request declares the capability'
    );
    assert.equal(session.connections.length, 1);
    assert.equal(session.connections[0].searchParams.has('sogniMedia'), false);
    assert.equal('mediaEncryption' in request, false, 'the job carries no mediaEncryption');
    assert.equal(project.encrypted, false);
    const [upload] = session.uploads();
    assert.deepEqual(await bytesOf(upload.body), pattern(3000), 'the upload is the plaintext');
    assert.equal(lib.isEncryptedMedia(await bytesOf(upload.body)), false);
    return queryNames(session.connections[0]);
  } finally {
    await session.close();
  }
}

/** Any other value leaves encryption off too, with a warning instead of an error. */
async function checkOtherValuesStayOff() {
  const session = await startSession({ mode: true, mediaKey: () => keyResponse(randomBytes(32)) });
  try {
    const { request } = await session.create();
    assert.equal(session.keyRequests().length, 0);
    assert.equal('mediaEncryption' in request, false);
    assert.ok(session.warnings.some(([message]) => /accepts only 'auto'/.test(message)));
  } finally {
    await session.close();
  }
}

async function checkAutoEncrypts(defaultQuery) {
  const accountKey = randomBytes(32);
  const retiredKey = randomBytes(32);
  const session = await startSession({
    mode: 'auto',
    mediaKey: () => keyResponse(accountKey, [retiredKey])
  });
  try {
    // Admitted at the handshake: the key is fetched once the connection says so.
    await waitFor(() => session.keyRequests().length === 1, 'the key request');
    const [keyRequest] = session.keyRequests();
    assert.equal(keyRequest.headers['api-key'], API_KEY, 'with the session credentials');
    assert.equal(CAPABILITY_HEADER in keyRequest.headers, false);

    // The handshake came before the key, so it declared nothing; the open
    // connection declares in-band instead of reconnecting.
    const [connection] = session.connections;
    assert.equal(connection.searchParams.has('sogniMedia'), false);
    assert.deepEqual(queryNames(connection), defaultQuery);
    await waitFor(() => session.declarations().length === 1, 'the in-band declaration');
    assert.deepEqual(session.declarations()[0], {
      connection: 0,
      type: 'mediaCapability',
      data: { sogniMedia: 'ciphertext-v1' }
    });

    const { project, request } = await session.create();
    assert.equal(project.encrypted, true);
    const field = request.mediaEncryption;
    assert.equal(field.version, 1);
    const projectKey = lib.base64ToBytes(field.key);
    assert.deepEqual(
      unwrapStanzaWithNodeCrypto(accountKey, lib.base64ToBytes(field.recipient)),
      projectKey,
      'the recipient record opens with the account key'
    );
    assert.equal(field.inputKeys.length, 1);

    // REST requests made while the key is held declare the capability; storage never sees it.
    const uploadUrlRequest = session.requests.find((r) => r.path === '/v1/image/uploadUrl');
    assert.equal(uploadUrlRequest.headers[CAPABILITY_HEADER], 'ciphertext-v1');
    const [upload] = session.uploads();
    assert.equal(CAPABILITY_HEADER in upload.headers, false);
    const uploaded = await bytesOf(upload.body);
    assert.equal(lib.isEncryptedMedia(uploaded), true, 'the input is uploaded encrypted');
    const inputKey = await lib.unwrapInputKey(projectKey, lib.base64ToBytes(field.inputKeys[0]));
    const forWorker = await lib.decryptMedia(uploaded, () => inputKey);
    assert.deepEqual(await bytesOf(forWorker.data), pattern(3000));

    // Results: ciphertext from a capability URL opens; an open URL's plaintext passes through.
    const job = project._addJob({
      id: 'JOB-AUTO',
      projectId: project.id,
      status: 'completed',
      step: 20,
      stepCount: 20,
      resultUrl: `${STORAGE}/result`
    });
    const sealed = await lib.encryptMedia(pattern(500, 9), {
      key: projectKey,
      contentType: 'image/png',
      recipient: lib.base64ToBytes(field.recipient)
    });
    const fetchStub = globalThis.fetch;
    try {
      globalThis.fetch = async () => new Response(sealed);
      const opened = await job.getResultData();
      assert.equal(opened.type, 'image/png');
      assert.deepEqual(await bytesOf(opened), pattern(500, 9));
      globalThis.fetch = async () => new Response(new Blob([pattern(500, 9)]));
      assert.deepEqual(await bytesOf(await job.getResultData()), pattern(500, 9));
    } finally {
      globalThis.fetch = fetchStub;
    }

    // Older media opens with the account's other key from the same response.
    const { importAccountKey, wrapProjectKey } = lib;
    const olderKey = randomBytes(32);
    const older = await lib.encryptMedia(pattern(40, 5), {
      key: olderKey,
      contentType: 'image/webp',
      recipient: await wrapProjectKey(await importAccountKey(retiredKey), olderKey)
    });
    assert.deepEqual(await bytesOf(await session.sogni.mediaEncryption.decrypt(older)), pattern(40, 5));
    const stranger = await lib.encryptMedia(pattern(40, 5), {
      key: olderKey,
      recipient: await wrapProjectKey(await importAccountKey(randomBytes(32)), olderKey)
    });
    await assert.rejects(
      () => session.sogni.mediaEncryption.decrypt(stranger),
      (error) => error.code === 'wrong_account_key'
    );

    // A model that takes its inputs as they are: the project is encrypted, its
    // inputs are uploaded unencrypted and no input keys are sent.
    for (const mediaEncryption of [undefined, true]) {
      const before = session.uploads().length;
      const asTheyAre = await session.create({ modelId: 'inputs-as-they-are-model', mediaEncryption });
      const field = asTheyAre.request.mediaEncryption;
      assert.equal(field.version, 1, `mediaEncryption ${mediaEncryption}: encrypted`);
      assert.ok(field.key && field.recipient);
      assert.equal('inputKeys' in field, false, 'no input keys');
      assert.equal(asTheyAre.project.encrypted, true);
      assert.deepEqual(await bytesOf(session.uploads()[before].body), pattern(3000), 'plain input');
    }
    const elsewhere = await session.create({
      modelId: 'inputs-as-they-are-model',
      startingImage: true
    });
    assert.equal(elsewhere.request.mediaEncryption.version, 1, 'inputs uploaded elsewhere are fine');

    // A project opts out; ineligible projects go plain rather than fail.
    for (const [label, params] of [
      ['mediaEncryption: false', { mediaEncryption: false }],
      ['a model that cannot render encrypted', { modelId: 'plain-model' }],
      ['media uploaded outside the SDK', { startingImage: true }]
    ]) {
      const plain = await session.create(params);
      assert.equal('mediaEncryption' in plain.request, false, `${label} is sent unencrypted`);
      assert.equal(plain.project.encrypted, false, label);
    }
    // Relaxed does not support encrypted projects yet: neither the request
    // nor the uploads are encrypted there.
    const uploadsBefore = session.uploads().length;
    const relaxed = await session.create({ network: 'relaxed' });
    assert.equal('mediaEncryption' in relaxed.request, false, 'a Relaxed project is sent plain');
    assert.equal(relaxed.request.network, 'relaxed');
    assert.equal(relaxed.project.encrypted, false);
    const relaxedUpload = session.uploads()[uploadsBefore];
    assert.deepEqual(await bytesOf(relaxedUpload.body), pattern(3000), 'its upload is plaintext');
    await assert.rejects(
      () => session.sogni.projects.create({
        type: 'image',
        modelId: 'encryptable-model',
        positivePrompt: 'x',
        numberOfMedia: 1,
        steps: 20,
        guidance: 7,
        network: 'relaxed',
        startingImage: new Blob([pattern(10)], { type: 'image/png' }),
        mediaEncryption: true
      }),
      (error) => error.code === 'unsupported' && /network/.test(error.message)
    );
    assert.equal(session.uploads().length, uploadsBefore + 1, 'nothing uploaded for the refusal');
    // An explicit request is still all-or-nothing.
    await assert.rejects(
      () => session.sogni.projects.create({
        type: 'image',
        modelId: 'plain-model',
        positivePrompt: 'x',
        numberOfMedia: 1,
        steps: 20,
        guidance: 7,
        mediaEncryption: true
      }),
      (error) => error.code === 'unsupported'
    );
    assert.equal(session.keyRequests().length, 1, 'the key is fetched once per sign-in');

    // A key fetched again on a connection that already declared adds nothing.
    await session.sogni.mediaEncryption.lock();
    assert.equal(await session.sogni.mediaEncryption.isUnlocked(), true, 'auto fetches it again');
    assert.equal(session.keyRequests().length, 2);
    await sleep(100);
    assert.equal(session.declarations().length, 1, 'a declaration is made once per connection');

    // A later connection declares at its handshake, since the key is held by then.
    session.drop();
    await waitFor(() => session.connections.length === 2, 'the reconnect');
    assert.equal(session.connections[1].searchParams.get('sogniMedia'), 'ciphertext-v1');
    assert.deepEqual(
      queryNames(session.connections[1]).filter((name) => name !== 'sogniMedia'),
      defaultQuery,
      'the capability is the handshake\'s only difference'
    );
    await waitFor(() => session.sogni.apiClient.socket._authenticatedSocket, 'authentication');
    assert.equal((await session.create()).request.mediaEncryption.version, 1);
    assert.equal(session.declarations().length, 1, 'no in-band declaration on that connection');
  } finally {
    await session.close();
  }
}

/**
 * Not admitted: an 'auto' client sends exactly what it would without the
 * option, and no key is requested. Availability starting on
 * the open socket starts encryption; closing it stops encrypting and keeps the
 * key for reading.
 */
async function checkAutoWaitsForAvailability(defaultQuery) {
  const session = await startSession({
    mode: 'auto',
    available: false,
    mediaKey: () => keyResponse(randomBytes(32))
  });
  try {
    const { request, project } = await session.create();
    assert.equal('mediaEncryption' in request, false);
    assert.equal(project.encrypted, false);
    assert.deepEqual(await bytesOf(session.uploads()[0].body), pattern(3000));
    assert.equal(await session.sogni.mediaEncryption.isUnlocked(), false);
    await sleep(100);
    assert.equal(session.keyRequests().length, 0, 'no key request');
    assert.equal(session.declaredRest().length, 0, 'no REST request declares');
    assert.deepEqual(queryNames(session.connections[0]), defaultQuery, 'nor the handshake');
    assert.equal(session.declarations().length, 0, 'nor an in-band message');

    // Availability starts while the socket stays connected.
    session.push('mediaEncryptionAvailabilityUpdated', true);
    await waitFor(() => session.keyRequests().length === 1, 'the key request');
    await waitFor(() => session.declarations().length === 1, 'the in-band declaration');
    const admitted = await session.create();
    assert.equal(admitted.request.mediaEncryption.version, 1);
    assert.ok(session.declaredRest().length > 0, 'REST declares from then on');

    // Availability ends: new projects go plain; the key stays for reading.
    session.push('mediaEncryptionAvailabilityUpdated', false);
    await waitFor(() => !session.sogni.mediaEncryption.available, 'availability to end');
    assert.equal('mediaEncryption' in (await session.create()).request, false);
    assert.equal(await session.sogni.mediaEncryption.isUnlocked(), true, 'the key is kept');
    assert.equal(session.keyRequests().length, 1);
    assert.equal(session.connections.length, 1);
  } finally {
    await session.close();
  }
}

async function checkKeyUnavailable() {
  const accountKey = randomBytes(32);
  let serve = unavailable;
  const session = await startSession({ mode: 'auto', mediaKey: () => serve() });
  const realNow = Date.now;
  let offset = 0;
  Date.now = () => realNow() + offset;
  try {
    await waitFor(() => session.keyRequests().length === 1, 'the key request');
    assert.equal(session.connections[0].searchParams.has('sogniMedia'), false);
    const first = await session.create();
    assert.equal('mediaEncryption' in first.request, false, '503: the project is sent plain');
    assert.equal(lib.isEncryptedMedia(await bytesOf(session.uploads()[0].body)), false);
    assert.equal(
      session.requests.some((r) => CAPABILITY_HEADER in r.headers),
      false,
      '503: no capability is declared'
    );
    assert.equal(session.declarations().length, 0);
    const warning = session.warnings.find(([message]) => /Media key unavailable/.test(message));
    assert.ok(warning, 'the failure is logged');
    assert.deepEqual(warning[1], { status: 503, errorCode: 135 });
    assert.equal(JSON.stringify(session.warnings).includes('key"'), false);

    serve = () => keyResponse(accountKey);
    offset = 4 * 60 * 1000;
    await session.create();
    assert.equal(session.keyRequests().length, 1, 'not asked again within 5 minutes');

    offset = 5 * 60 * 1000 + 1000;
    const later = await session.create();
    assert.equal(session.keyRequests().length, 2, 'asked again after 5 minutes');
    assert.equal(later.request.mediaEncryption.version, 1, 'and used once it arrives');
    assert.equal(session.requests.at(-1).headers[CAPABILITY_HEADER], undefined);
    assert.equal(
      session.requests.find((r) => r.path === '/v1/image/uploadUrl' && CAPABILITY_HEADER in r.headers)
        ?.headers[CAPABILITY_HEADER],
      'ciphertext-v1',
      'REST declares the capability from then on'
    );
    await waitFor(() => session.declarations().length === 1, 'the in-band declaration');
    assert.equal(session.connections.length, 1, 'declared without reconnecting');

    // A new sign-in asks at once, without waiting out a failure.
    serve = unavailable;
    const auth = session.sogni.apiClient.auth;
    auth.clear();
    assert.equal(await session.sogni.mediaEncryption.isUnlocked(), false, 'sign-out drops the key');
    const failures = () =>
      session.warnings.filter(([message]) => /Media key unavailable/.test(message)).length;
    const failed = failures();
    await auth.authenticate(API_KEY);
    await waitFor(() => session.keyRequests().length === 3, 'key request after sign-in');
    // That request failed too, which starts a new 5-minute wait...
    await waitFor(() => failures() === failed + 1, 'the failure to be handled');
    serve = () => keyResponse(accountKey);
    auth.clear();
    await auth.authenticate(API_KEY);
    // ...which the next sign-in does not wait out.
    await waitFor(() => session.keyRequests().length === 4, 'key request after the next sign-in');
  } finally {
    Date.now = realNow;
    await session.close();
  }
}

/**
 * 409 (ErrorCodes.MEDIA_KEY_DELETED, 205): media encryption was turned off for
 * the account. Plain projects, no further key request this session, and never
 * a request that turns it back on.
 */
async function checkKeyTurnedOff() {
  const session = await startSession({
    mode: 'auto',
    mediaKey: () =>
      json({ status: 'error', errorCode: 205, message: 'Media key deleted' }, 409)
  });
  const realNow = Date.now;
  let offset = 0;
  Date.now = () => realNow() + offset;
  try {
    await waitFor(() => session.keyRequests().length === 1, 'the key request');
    assert.equal('mediaEncryption' in (await session.create()).request, false);
    assert.ok(session.warnings.some(([message]) => /turned off for this account/.test(message)));
    offset = 10 * 60 * 1000;
    assert.equal('mediaEncryption' in (await session.create()).request, false);
    assert.equal(await session.sogni.mediaEncryption.isUnlocked(), false);
    session.push('mediaEncryptionAvailabilityUpdated', false);
    session.push('mediaEncryptionAvailabilityUpdated', true);
    await sleep(100);
    assert.equal(session.keyRequests().length, 1, 'not asked again this session');
    assert.equal(
      session.requests.filter((r) => r.path === '/v1/account/media-key' && r.method !== 'GET')
        .length,
      0,
      'never turned back on by the SDK'
    );
    assert.equal(session.declarations().length + session.declaredRest().length, 0);
    // The next sign-in is a new session and may ask again.
    const auth = session.sogni.apiClient.auth;
    auth.clear();
    await auth.authenticate(API_KEY);
    await waitFor(() => session.keyRequests().length === 2, 'the key request after sign-in');
  } finally {
    Date.now = realNow;
    await session.close();
  }
}

/**
 * `declareMediaCapability: false`: projects are still encrypted once enabled,
 * but nothing ever asks for encrypted result links, and the result readers
 * return what they are given.
 */
async function checkWithoutDeclaring() {
  const accountKey = randomBytes(32);
  const session = await startSession({
    mode: 'auto',
    declareMediaCapability: false,
    mediaKey: () => keyResponse(accountKey)
  });
  try {
    await waitFor(() => session.keyRequests().length === 1, 'the key request');
    const { project, request } = await session.create();
    assert.equal(request.mediaEncryption.version, 1, 'still encrypted');
    assert.equal(request.mediaEncryption.inputKeys.length, 1);
    assert.equal(project.encrypted, true);
    session.drop();
    await waitFor(() => session.connections.length === 2, 'the reconnect');
    await waitFor(() => session.sogni.apiClient.socket._authenticatedSocket, 'authentication');
    assert.equal((await session.create()).request.mediaEncryption.version, 1);
    assert.equal(session.declaredRest().length, 0, 'no REST request declares');
    assert.equal(session.declarations().length, 0, 'no in-band message');
    for (const connection of session.connections) {
      assert.equal(connection.searchParams.has('sogniMedia'), false, 'no handshake parameter');
    }
    const job = project._addJob({
      id: 'JOB-UNDECLARED',
      projectId: project.id,
      status: 'completed',
      step: 20,
      stepCount: 20,
      resultUrl: `${STORAGE}/result`
    });
    const sealed = await lib.encryptMedia(pattern(300, 4), {
      key: lib.base64ToBytes(request.mediaEncryption.key),
      contentType: 'image/png',
      recipient: lib.base64ToBytes(request.mediaEncryption.recipient)
    });
    const fetchStub = globalThis.fetch;
    try {
      globalThis.fetch = async () => new Response(new Blob([pattern(300, 4)]));
      assert.deepEqual(await bytesOf(await job.getResultData()), pattern(300, 4));
      globalThis.fetch = async () => new Response(sealed);
      assert.deepEqual(await bytesOf(await job.getResultData()), pattern(300, 4));
    } finally {
      globalThis.fetch = fetchStub;
    }
  } finally {
    await session.close();
  }
}

/** A key server that does not answer holds a new project for at most 5 seconds. */
async function checkSlowKeyServer() {
  let release;
  const answered = new Promise((resolve) => (release = resolve));
  const session = await startSession({
    mode: 'auto',
    mediaKey: async () => {
      await answered;
      return keyResponse(randomBytes(32));
    }
  });
  try {
    await waitFor(() => session.keyRequests().length === 1, 'the key request');
    const started = Date.now();
    const slow = await session.create();
    const waited = Date.now() - started;
    assert.ok(waited >= 4900 && waited < 9000, `the project waited ${waited} ms for the key`);
    assert.equal('mediaEncryption' in slow.request, false, 'and was then sent plain');
    // Admission closes while a project waits for the key: it is sent plain.
    const waiting = session.create();
    await sleep(200);
    session.push('mediaEncryptionAvailabilityUpdated', false);
    await waitFor(() => !session.sogni.mediaEncryption.available, 'availability to end');
    release();
    assert.equal('mediaEncryption' in (await waiting).request, false);
    await waitFor(() => session.declarations().length === 1, 'the in-band declaration');
    session.push('mediaEncryptionAvailabilityUpdated', true);
    await waitFor(() => session.sogni.mediaEncryption.available, 'availability to start');
    assert.equal((await session.create()).request.mediaEncryption.version, 1);
  } finally {
    await session.close();
  }
}

/** A client connected to Relaxed sends its projects plain, uploads included. */
async function checkRelaxedConnection() {
  const session = await startSession({
    mode: 'auto',
    network: 'relaxed',
    mediaKey: () => keyResponse(randomBytes(32))
  });
  try {
    assert.equal(await session.sogni.mediaEncryption.isUnlocked(), true);
    const { request, project } = await session.create();
    assert.equal('mediaEncryption' in request, false);
    assert.equal(project.encrypted, false);
    assert.deepEqual(await bytesOf(session.uploads()[0].body), pattern(3000));
    // A Fast project from the same connection is encrypted.
    const fast = await session.create({ network: 'fast' });
    assert.equal(fast.request.mediaEncryption.version, 1);
  } finally {
    await session.close();
  }
}

/** A REST-only client has no connection to admit it, so it never fetches a key or declares. */
async function checkRestOnlyClient() {
  const session = await startSession({
    mode: 'auto',
    disableSocket: true,
    mediaKey: () => keyResponse(randomBytes(32))
  });
  try {
    await session.sogni.apiClient.rest.get('/v1/account/balance');
    assert.equal(await session.sogni.mediaEncryption.isUnlocked(), false);
    assert.equal(session.connections.length, 0, 'no socket');
    assert.equal(session.keyRequests().length, 0);
    assert.equal(session.declaredRest().length, 0);
  } finally {
    await session.close();
  }
}

/** A key response in a format this SDK does not know is not used. */
async function checkUnknownKeyFormat() {
  const session = await startSession({
    mode: 'auto',
    mediaKey: () =>
      json({
        status: 'success',
        data: { version: 2, current: { id: 'mk2_x', key: randomBytes(32).toString('base64') } }
      })
  });
  try {
    await waitFor(() => session.keyRequests().length === 1, 'the key request');
    const { request } = await session.create();
    assert.equal('mediaEncryption' in request, false);
    assert.ok(session.warnings.some(([message]) => /Media key unavailable/.test(message)));
    assert.equal(session.declarations().length, 0);
    assert.equal(session.declaredRest().length, 0);
  } finally {
    await session.close();
  }
}

async function run() {
  const defaultQuery = await checkDefaultIsUnchanged();
  await checkOtherValuesStayOff();
  await checkAutoEncrypts(defaultQuery);
  await checkAutoWaitsForAvailability(defaultQuery);
  await checkRelaxedConnection();
  await checkRestOnlyClient();
  await checkUnknownKeyFormat();
  await checkKeyUnavailable();
  await checkKeyTurnedOff();
  await checkWithoutDeclaring();
  await checkSlowKeyServer();
  console.log('check-media-encryption-auto: OK');
}

// A promise that never settles drains the event loop, which would otherwise exit 0 unseen.
process.exitCode = 1;
run().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  }
);
