'use strict';
/**
 * Media encryption: container format, account key, and the project upload path.
 *
 * The known-answer vectors in fixtures/media-encryption-vectors.json pin the
 * byte format. The Comfy worker's node:crypto implementation is tested against
 * the same file, so a change that alters these bytes breaks interoperability:
 * regenerate with `--write-fixture` only for a deliberate format change.
 */
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Wallet } = require('ethers');

const lib = require('../dist/lib/mediaEncryption/index.js');
const { redactMediaKey } = require('../dist/lib/mediaEncryption/redact.js');
const MediaEncryptionApi = require('../dist/MediaEncryption/index.js').default;
const ProjectsApi = require('../dist/Projects/index.js').default;
const { projectParamsFromRecoveredProject } = require('../dist/Projects/recovery.js');
const { MEDIA_ENCRYPTION_ERROR_CODES } = require('../dist/index.js');

const FIXTURE = path.join(__dirname, 'fixtures', 'media-encryption-vectors.json');
const hex = (bytes) => Buffer.from(bytes).toString('hex');
const unhex = (value) => new Uint8Array(Buffer.from(value, 'hex'));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const bytesOf = async (blob) => new Uint8Array(await blob.arrayBuffer());

/** Deterministic, non-repeating plaintext so segment order mistakes are visible. */
function pattern(length) {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = (i * 31 + (i >>> 8) * 7 + 3) & 0xff;
  return out;
}

const WALLET_KEY = unhex('0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20');
const PROJECT_KEY = unhex('a0a1a2a3a4a5a6a7a8a9aaabacadaeafb0b1b2b3b4b5b6b7b8b9babbbcbdbebf');
const RECIPIENT_NONCE = unhex('c0c1c2c3c4c5c6c7c8c9cacb');
const SALT = unhex('d0d1d2d3d4d5d6d7d8d9dadbdcdddedfe0e1e2e3e4e5e6e7e8e9eaebecedeeef');
const NONCE_PREFIX = unhex('f0f1f2f3f4f5f6');
const INPUT_WRAP_NONCE = unhex('b0b1b2b3b4b5b6b7b8b9babb');

/** Input files: everything about them is derived from the account key and their content. */
const INPUT_CASES = [
  { name: 'input-image', plaintextLength: 2500, contentType: 'image/png', inline: true },
  { name: 'input-two-segments', plaintextLength: 1048576 + 17, contentType: 'video/mp4' }
];

const FILE_CASES = [
  {
    name: 'empty',
    plaintextLength: 0,
    contentType: 'image/png',
    segmentSizeLog2: 20,
    inline: true
  },
  {
    name: 'small-with-recipient',
    plaintextLength: 37,
    contentType: 'image/jpeg',
    segmentSizeLog2: 20,
    inline: true
  },
  {
    name: 'no-content-type-no-recipient',
    plaintextLength: 5,
    contentType: '',
    segmentSizeLog2: 20,
    inline: true,
    noRecipient: true
  },
  {
    name: 'three-segments',
    plaintextLength: 150000,
    contentType: 'video/mp4',
    segmentSizeLog2: 16
  },
  {
    name: 'exact-two-segments',
    plaintextLength: 131072,
    contentType: 'audio/mpeg',
    segmentSizeLog2: 16
  }
];

async function buildVectors() {
  const account = await lib.deriveAccountKey(WALLET_KEY);
  const recipient = await lib.wrapProjectKey(account, PROJECT_KEY, RECIPIENT_NONCE);
  const files = [];
  for (const spec of FILE_CASES) {
    const sealed = await bytesOf(
      await lib.encryptMedia(pattern(spec.plaintextLength), {
        key: PROJECT_KEY,
        contentType: spec.contentType,
        recipient: spec.noRecipient ? undefined : recipient,
        segmentSizeLog2: spec.segmentSizeLog2,
        deterministic: { salt: SALT, noncePrefix: NONCE_PREFIX }
      })
    );
    files.push({
      name: spec.name,
      plaintextLength: spec.plaintextLength,
      contentType: spec.contentType,
      segmentSizeLog2: spec.segmentSizeLog2,
      hasRecipient: !spec.noRecipient,
      ciphertextLength: sealed.length,
      ciphertextSha256: sha256(sealed),
      ...(spec.inline ? { ciphertext: hex(sealed) } : {})
    });
  }
  const inputs = [];
  for (const spec of INPUT_CASES) {
    const plaintext = pattern(spec.plaintextLength);
    const material = await lib.inputMaterialForMedia(account, plaintext, spec.contentType);
    const sealed = await bytesOf(
      await lib.encryptMedia(plaintext, {
        key: material.key,
        contentType: spec.contentType,
        recipient: await lib.wrapProjectKey(account, material.key, material.recipientNonce),
        deterministic: { salt: material.salt, noncePrefix: material.noncePrefix }
      })
    );
    inputs.push({
      name: spec.name,
      plaintextLength: spec.plaintextLength,
      contentType: spec.contentType,
      plaintextSha256: sha256(plaintext),
      inputKey: hex(material.key),
      salt: hex(material.salt),
      noncePrefix: hex(material.noncePrefix),
      recipientNonce: hex(material.recipientNonce),
      // What the worker is sent: the input key wrapped under the project key.
      wrappedInputKey: hex(await lib.wrapInputKey(PROJECT_KEY, material.key, INPUT_WRAP_NONCE)),
      ciphertextLength: sealed.length,
      ciphertextSha256: sha256(sealed),
      ...(spec.inline ? { ciphertext: hex(sealed) } : {})
    });
  }
  return {
    format: 'SOGNIE2E',
    version: 1,
    plaintextPattern: 'byte[i] = (i * 31 + (i >>> 8) * 7 + 3) & 0xff',
    walletPrivateKey: hex(WALLET_KEY),
    projectKey: hex(PROJECT_KEY),
    recipientNonce: hex(RECIPIENT_NONCE),
    recipient: hex(recipient),
    salt: hex(SALT),
    noncePrefix: hex(NONCE_PREFIX),
    files,
    inputWrapNonce: hex(INPUT_WRAP_NONCE),
    inputs
  };
}

async function checkVectors() {
  const vectors = await buildVectors();
  if (process.argv.includes('--write-fixture')) {
    fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
    fs.writeFileSync(FIXTURE, `${JSON.stringify(vectors, null, 2)}\n`);
    console.log(`check-media-encryption: wrote ${path.relative(process.cwd(), FIXTURE)}`);
  }
  const pinned = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  assert.deepEqual(vectors, pinned, 'container bytes changed: the format is a cross-repo contract');

  // An input opens for the worker (its wrapped key, under the project key) and for the artist
  // (the recipient stanza), and another account derives different bytes for the same file.
  const owner = await lib.deriveAccountKey(unhex(pinned.walletPrivateKey));
  for (const input of pinned.inputs.filter((entry) => entry.ciphertext)) {
    const inputKey = await lib.unwrapInputKey(
      unhex(pinned.projectKey),
      unhex(input.wrappedInputKey)
    );
    assert.equal(hex(inputKey), input.inputKey);
    const forWorker = await lib.decryptMedia(unhex(input.ciphertext), () => inputKey);
    assert.deepEqual(await bytesOf(forWorker.data), pattern(input.plaintextLength));
    const forArtist = await lib.decryptMedia(unhex(input.ciphertext), (header) =>
      lib.unwrapProjectKey(owner, header.recipient)
    );
    assert.equal(forArtist.contentType, input.contentType);
    const stranger = await lib.deriveAccountKey(unhex(pinned.walletPrivateKey).reverse());
    const theirs = await lib.inputMaterialForMedia(
      stranger,
      pattern(input.plaintextLength),
      input.contentType
    );
    assert.notEqual(hex(theirs.key), input.inputKey, 'input keys are per account');
    const otherType = await lib.inputMaterialForMedia(
      owner,
      pattern(input.plaintextLength),
      'image/webp'
    );
    assert.notEqual(hex(otherType.key), input.inputKey, 'and per content type');
    await assert.rejects(
      () => lib.unwrapInputKey(unhex(pinned.salt), unhex(input.wrappedInputKey)),
      (error) => error.code === 'authentication_failed'
    );
  }

  // Decrypt straight from the pinned bytes, through the recipient stanza.
  const account = await lib.deriveAccountKey(unhex(pinned.walletPrivateKey));
  for (const file of pinned.files.filter((entry) => entry.ciphertext)) {
    const opened = await lib.decryptMedia(unhex(file.ciphertext), (header) =>
      file.hasRecipient ? lib.unwrapProjectKey(account, header.recipient) : unhex(pinned.projectKey)
    );
    assert.equal(opened.contentType, file.contentType);
    assert.equal(opened.data.type, file.contentType);
    assert.deepEqual(await bytesOf(opened.data), pattern(file.plaintextLength));
  }
}

async function checkRoundTripsAndTampering() {
  const account = await lib.deriveAccountKey(WALLET_KEY);
  const recipient = await lib.wrapProjectKey(account, PROJECT_KEY);
  const viaRecipient = (header) => lib.unwrapProjectKey(account, header.recipient);

  // Blob, Buffer and ArrayBuffer sources; sizes around every segment boundary.
  const segment = 1 << 16;
  for (const length of [0, 1, segment - 1, segment, segment + 1, 3 * segment, 3 * segment + 17]) {
    const plaintext = pattern(length);
    for (const source of [
      new Blob([plaintext]),
      Buffer.from(plaintext),
      plaintext.buffer.slice(0)
    ]) {
      const sealed = await lib.encryptMedia(source, {
        key: PROJECT_KEY,
        contentType: 'image/webp',
        recipient,
        segmentSizeLog2: 16
      });
      assert.equal(sealed.type, 'application/octet-stream');
      const expectedSegments = Math.max(1, Math.ceil(length / segment));
      const header = await lib.readMediaHeader(sealed);
      assert.equal(sealed.size, header.bytes.length + length + expectedSegments * 16);
      const opened = await lib.decryptMedia(sealed, viaRecipient);
      assert.deepEqual(await bytesOf(opened.data), plaintext, `round trip of ${length} bytes`);
    }
  }

  // Two encryptions of the same bytes never match.
  const once = await bytesOf(await lib.encryptMedia(pattern(64), { key: PROJECT_KEY }));
  const twice = await bytesOf(await lib.encryptMedia(pattern(64), { key: PROJECT_KEY }));
  assert.notDeepEqual(once, twice);

  const sealed = await bytesOf(
    await lib.encryptMedia(pattern(3 * segment + 17), {
      key: PROJECT_KEY,
      contentType: 'video/mp4',
      recipient,
      segmentSizeLog2: 16
    })
  );
  const header = lib.parseHeader(sealed);
  const headerLength = header.bytes.length;
  const sealedSegment = segment + 16;
  const failsAuth = async (bytes, label) =>
    assert.rejects(
      () => lib.decryptMedia(bytes, viaRecipient),
      (error) => error.code === 'authentication_failed',
      label
    );

  const flipped = (index) => {
    const copy = sealed.slice();
    copy[index] ^= 0x01;
    return copy;
  };
  await failsAuth(flipped(headerLength + 5), 'a flipped ciphertext bit is rejected');
  await failsAuth(flipped(sealed.length - 1), 'a flipped tag bit is rejected');
  await failsAuth(flipped(50), 'a changed content type is rejected');
  await failsAuth(flipped(10), 'a changed salt is rejected');
  await failsAuth(flipped(42), 'a changed nonce prefix is rejected');

  // Truncation exactly on a segment boundary leaves well-formed segments, none marked last.
  await failsAuth(
    sealed.slice(0, headerLength + 2 * sealedSegment),
    'truncation on a segment boundary is rejected'
  );
  await failsAuth(
    sealed.slice(0, headerLength + sealedSegment + 100),
    'truncation inside a segment is rejected'
  );
  // Appending data shifts which segment is last.
  await failsAuth(Buffer.concat([sealed, Buffer.alloc(40)]), 'appended data is rejected');

  // Swapping two full segments.
  const swapped = sealed.slice();
  swapped.set(
    sealed.subarray(headerLength + sealedSegment, headerLength + 2 * sealedSegment),
    headerLength
  );
  swapped.set(
    sealed.subarray(headerLength, headerLength + sealedSegment),
    headerLength + sealedSegment
  );
  await failsAuth(swapped, 'reordered segments are rejected');

  // A segment from another file of the same project does not transplant.
  const other = await bytesOf(
    await lib.encryptMedia(pattern(3 * segment + 17), {
      key: PROJECT_KEY,
      contentType: 'video/mp4',
      recipient,
      segmentSizeLog2: 16
    })
  );
  const transplanted = sealed.slice();
  const otherHeaderLength = lib.parseHeader(other).bytes.length;
  transplanted.set(
    other.subarray(otherHeaderLength, otherHeaderLength + sealedSegment),
    headerLength
  );
  await failsAuth(transplanted, 'a segment from another file is rejected');

  await assert.rejects(
    () => lib.decryptMedia(sealed, () => new Uint8Array(32)),
    (error) => error.code === 'authentication_failed'
  );
  await assert.rejects(
    () => lib.decryptMedia(pattern(200), viaRecipient),
    (error) => error.code === 'not_encrypted'
  );
  await assert.rejects(
    () => lib.decryptMedia(sealed.slice(0, 30), viaRecipient),
    (error) => error.code === 'malformed'
  );
  await assert.rejects(
    () => lib.decryptMedia(sealed.slice(0, headerLength + 4), viaRecipient),
    (error) => error.code === 'malformed'
  );
  const futureVersion = sealed.slice();
  futureVersion[8] = 2;
  await assert.rejects(
    () => lib.decryptMedia(futureVersion, viaRecipient),
    (error) => error.code === 'unsupported_version'
  );

  // Recipient stanza: another account's key is named as such, not reported as corruption.
  const stranger = await lib.deriveAccountKey(unhex('ff'.repeat(32)));
  await assert.rejects(
    () => lib.unwrapProjectKey(stranger, recipient),
    (error) => error.code === 'wrong_account_key'
  );
  await assert.rejects(
    () => lib.unwrapProjectKey(account, new Uint8Array(0)),
    (error) => error.code === 'no_recipient'
  );
  const forgedStanza = recipient.slice();
  forgedStanza[forgedStanza.length - 1] ^= 1;
  await assert.rejects(
    () => lib.unwrapProjectKey(account, forgedStanza),
    (error) => error.code === 'authentication_failed'
  );
  assert.equal(recipient.length, lib.RECIPIENT_BYTES);
  assert.equal(account.key.extractable, false, 'the account key must not be exportable');
  assert.equal(account.checkKey.extractable, false, 'nor the key that derives its check value');

  // Workers and storage see the stanza. Nothing in it may stay the same from one
  // project to the next, or an account's projects could be linked together.
  const stanzas = await Promise.all([1, 2, 3].map(() => lib.wrapProjectKey(account, PROJECT_KEY)));
  for (let offset = 1; offset < lib.RECIPIENT_BYTES; offset += 4) {
    const slices = new Set(stanzas.map((stanza) => hex(stanza.subarray(offset, offset + 4))));
    assert.equal(
      slices.size,
      stanzas.length,
      `stanza bytes ${offset}-${offset + 3} differ per project`
    );
  }
  for (const stanza of stanzas)
    assert.deepEqual(await lib.unwrapProjectKey(account, stanza), PROJECT_KEY);

  assert.equal(lib.isEncryptedMedia(sealed), true);
  assert.equal(lib.isEncryptedMedia(pattern(64)), false);
  assert.equal(lib.isEncryptedMedia(new Uint8Array(3)), false);
  assert.deepEqual(lib.base64ToBytes(lib.bytesToBase64(pattern(70000))), pattern(70000));
}

class StubAuth {
  constructor() {
    this.listeners = [];
    this.isAuthenticated = true;
  }
  on(event, listener) {
    if (event === 'updated') this.listeners.push(listener);
    return () => {};
  }
  emitUpdated(value) {
    this.listeners.forEach((listener) => listener(value));
  }
  async authenticateRequest(options) {
    return options;
  }
  clear() {}
}

/**
 * `savedUploads: true` stands in for the upload library: it keeps whatever is
 * prepared under the hash it was told, and answers "ready" the second time.
 */
function stubClient({ savedUploads = false } = {}) {
  const sent = [];
  const savedUploadChecks = [];
  const library = { prepared: [], bound: [], byHash: new Map() };
  return {
    sent,
    savedUploadChecks,
    library,
    appSource: 'check-media-encryption',
    attribution: {},
    auth: new StubAuth(),
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    on: () => () => {},
    resolveWorkloadAttribution: () => undefined,
    rest: {
      get: async (requestPath) => {
        if (requestPath === '/v1/assets/capabilities') {
          savedUploadChecks.push(requestPath);
          return { status: 'success', data: { enabled: savedUploads } };
        }
        return { status: 'success', data: { uploadUrl: 'https://storage.example.test/presigned' } };
      },
      post: async (requestPath, body) => {
        if (savedUploads && requestPath === '/v1/assets/prepare') {
          library.prepared.push(body);
          const key = `${body.sha256}:${body.contentType}`;
          const existing = library.byHash.get(key);
          if (existing) return { status: 'success', data: { ...existing, reused: true } };
          const id = `asset-${library.byHash.size + 1}`;
          library.byHash.set(key, { id, state: 'ready' });
          return {
            status: 'success',
            data: {
              id,
              state: 'uploading',
              reused: false,
              uploadUrl: `https://library.example.test/${id}`,
              uploadHeaders: { 'Content-Type': body.contentType }
            }
          };
        }
        if (savedUploads && /^\/v1\/assets\/[^/]+\/finalize$/.test(requestPath)) {
          return { status: 'success', data: { id: requestPath.split('/')[3], state: 'ready' } };
        }
        if (savedUploads && /^\/v1\/assets\/[^/]+\/bind$/.test(requestPath)) {
          library.bound.push({ id: requestPath.split('/')[3], ...body });
          return { status: 'success', data: {} };
        }
        throw new Error(`unexpected POST ${requestPath}`);
      }
    },
    socket: {
      isConnected: true,
      supernetType: 'fast',
      listeners: {},
      on(event, listener) {
        (this.listeners[event] ||= []).push(listener);
        return () => {};
      },
      deliver(event, data) {
        (this.listeners[event] || []).forEach((listener) => listener(data));
      },
      send: async (type, data) => sent.push({ type, data }),
      get: async (requestPath) => {
        if (requestPath === '/api/v1/models/list') {
          return [
            {
              id: 'encryptable-model',
              name: 'Encryptable',
              SID: 1,
              tier: 'image-tier',
              media: 'image',
              supportsMediaEncryption: true
            },
            { id: 'plain-model', name: 'Plain', SID: 2, tier: 'image-tier', media: 'image' }
          ];
        }
        if (requestPath === '/api/v2/models/tiers') {
          const range = { min: 1, max: 50, default: 20, decimals: 0 };
          const options = { allowed: ['euler'], default: 'euler' };
          return {
            'image-tier': {
              benchmark: { sec: 1, secCN: 1, secMaxPreviews: 1 },
              steps: range,
              guidance: range,
              scheduler: { allowed: ['simple'], default: 'simple' },
              sampler: options
            }
          };
        }
        throw new Error(`unexpected socket GET ${requestPath}`);
      }
    }
  };
}

function stubAccount(username, password, { authMethods } = {}) {
  const wallet = new Wallet(`0x${hex(WALLET_KEY)}`);
  const listeners = [];
  return {
    wallet,
    currentAccount: {
      username,
      walletAddress: wallet.address,
      on: (event, listener) => {
        if (event === 'updated') listeners.push(listener);
        return () => {};
      },
      /** What AccountApi does on logout, before anyone else hears about it. */
      clear() {
        this.walletAddress = undefined;
        this.username = undefined;
      },
      emitUpdated: () => listeners.forEach((listener) => listener(['walletAddress']))
    },
    getWallet: (name, secret) =>
      name === username && secret === password ? wallet : Wallet.createRandom(),
    me: async () => ({
      username,
      walletAddress: wallet.address,
      ...(authMethods ? { authMethods } : {})
    })
  };
}

async function checkAccountKeyLifecycle() {
  const client = stubClient();
  const account = stubAccount('artist', 'correct horse');
  const store = new lib.MemoryAccountKeyStore();
  const api = new MediaEncryptionApi({ client, eip712: {} }, account, store);
  const events = [];
  api.on('unlocked', () => events.push('unlocked'));
  api.on('locked', () => events.push('locked'));

  assert.equal(await api.isUnlocked(), false, 'a resumed session starts locked');
  await assert.rejects(
    () => api._createProjectEncryption(),
    (error) => error.code === 'locked'
  );
  await assert.rejects(
    () => api.unlock('wrong password'),
    (error) => error.code === 'invalid_password'
  );
  assert.equal(await api.isUnlocked(), false);

  await api.unlock('correct horse');
  assert.equal(await api.isUnlocked(), true);
  assert.ok(await store.load(account.wallet.address), 'the key is remembered on the device');

  // A second client instance on the same device (a reload) needs no password.
  const reloaded = new MediaEncryptionApi({ client: stubClient(), eip712: {} }, account, store);
  assert.equal(await reloaded.isUnlocked(), true);

  // The login hook derives the same key, so media encrypted before a reload still opens.
  const project = await api._createProjectEncryption();
  assert.equal(project.wire().version, 1);
  assert.equal(lib.base64ToBytes(project.wire().key).length, 32);
  assert.equal(lib.base64ToBytes(project.wire().recipient).length, lib.RECIPIENT_BYTES);
  assert.equal('inputKeys' in project.wire(), false, 'no inputs, no input keys');
  const source = new Blob([pattern(5000)], { type: 'image/png' });
  const sealed = await project.encrypt(source, 'image/png');
  assert.equal(await project.encrypt(source, 'image/png'), sealed, 'one media object, one file');
  assert.equal(project.wire().inputKeys.length, 1);
  assert.equal(lib.base64ToBytes(project.wire().inputKeys[0]).length, lib.WRAPPED_INPUT_KEY_BYTES);
  // The same content in another project encrypts to the same bytes, which is what lets it be reused.
  const again = await (
    await api._createProjectEncryption()
  ).encrypt(new Blob([pattern(5000)], { type: 'image/png' }), 'image/png');
  assert.deepEqual(await bytesOf(again), await bytesOf(sealed));
  const fresh = new MediaEncryptionApi(
    { client: stubClient(), eip712: {} },
    account,
    new lib.MemoryAccountKeyStore()
  );
  await account._onWalletDerived(account.wallet);
  assert.equal(await fresh.isUnlocked(), true, 'login derives the key without a second prompt');
  const opened = await fresh.decrypt(sealed);
  assert.equal(opened.type, 'image/png');
  assert.deepEqual(await bytesOf(opened), pattern(5000));
  assert.equal(api.isEncrypted(await bytesOf(sealed)), true);

  // fetchDecrypted opens encrypted bodies and passes ordinary ones through.
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) =>
      new Response(url.includes('encrypted') ? sealed : new Blob([pattern(9)]));
    assert.deepEqual(
      await bytesOf(await api.fetchDecrypted('https://cdn.example.test/encrypted')),
      pattern(5000)
    );
    assert.deepEqual(
      await bytesOf(await api.fetchDecrypted('https://cdn.example.test/plain')),
      pattern(9)
    );
  } finally {
    globalThis.fetch = realFetch;
  }

  // Signing out removes the key from memory and from the device.
  client.auth.emitUpdated(false);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(await store.load(account.wallet.address), null);
  assert.equal(await api.isUnlocked(), false);
  assert.deepEqual(events, ['unlocked', 'locked']);

  // A custom secret works for headless use and is independent of the password key.
  const headless = new MediaEncryptionApi(
    { client: stubClient(), eip712: {} },
    account,
    new lib.MemoryAccountKeyStore()
  );
  await headless.setAccountKey(unhex('11'.repeat(32)));
  const headlessProject = await headless._createProjectEncryption();
  const headlessSealed = await headlessProject.encrypt(pattern(10), 'image/png');
  assert.deepEqual(await bytesOf(await headless.decrypt(headlessSealed)), pattern(10));
  await api.unlock('correct horse');
  await assert.rejects(
    () => api.decrypt(headlessSealed),
    (error) => error.code === 'wrong_account_key'
  );
}

async function checkKeyHygiene() {
  // Debug logs print whole socket messages; the project key must never be in them.
  const key = lib.bytesToBase64(PROJECT_KEY);
  const request = {
    jobID: 'P',
    keyFrames: [{ modelID: 'm' }],
    mediaEncryption: { version: 1, key, recipient: 'cmVjaXBpZW50' }
  };
  const control = { type: 'socket-send', payload: { type: 'jobRequest', data: request } };
  for (const logged of [
    redactMediaKey(request),
    redactMediaKey(control),
    redactMediaKey([control])
  ]) {
    const text = JSON.stringify(logged);
    assert.equal(text.includes(key), false, 'a logged message never contains the project key');
    assert.equal(text.includes('cmVjaXBpZW50'), true, 'only the key is replaced');
  }
  assert.equal(request.mediaEncryption.key, key, 'the real message is not modified');
  const ordinary = { jobID: 'P', keyFrames: [{ modelID: 'm' }] };
  assert.equal(
    redactMediaKey(ordinary),
    ordinary,
    'messages without a key are passed through as they are'
  );
  assert.equal(redactMediaKey(null), null);
  assert.equal(redactMediaKey('text'), 'text');

  // Logging out after a reload, before any encrypted media was touched, still
  // removes the stored key: currentAccount is already cleared by then.
  const store = new lib.MemoryAccountKeyStore();
  const account = stubAccount('artist', 'correct horse');
  const firstLoad = new MediaEncryptionApi({ client: stubClient(), eip712: {} }, account, store);
  await firstLoad.unlock('correct horse');
  assert.ok(await store.load(account.wallet.address));
  const reloadedClient = stubClient();
  new MediaEncryptionApi({ client: reloadedClient, eip712: {} }, account, store);
  account.currentAccount.emitUpdated(); // the session resumes; nothing loads the key
  account.currentAccount.clear(); // AccountApi clears first on logout...
  reloadedClient.auth.emitUpdated(false); // ...then this group hears about it
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    await store.load(account.wallet.address),
    null,
    'logout removes a key this page never loaded'
  );

  // A key the integrator set survives a later password login; an explicit unlock replaces it.
  const custom = stubAccount('artist', 'correct horse');
  const headless = new MediaEncryptionApi(
    { client: stubClient(), eip712: {} },
    custom,
    new lib.MemoryAccountKeyStore()
  );
  await headless.setAccountKey(unhex('22'.repeat(32)));
  const sealedWithCustom = await (
    await headless._createProjectEncryption()
  ).encrypt(pattern(8), 'image/png');
  await custom._onWalletDerived(custom.wallet);
  assert.deepEqual(
    await bytesOf(await headless.decrypt(sealedWithCustom)),
    pattern(8),
    'login keeps the custom key'
  );
  await headless.unlock('correct horse');
  await assert.rejects(
    () => headless.decrypt(sealedWithCustom),
    (error) => error.code === 'wrong_account_key'
  );

  // Blocked or broken key storage reads as "locked", not as a failed submission.
  const blocked = new MediaEncryptionApi(
    { client: stubClient(), eip712: {} },
    stubAccount('artist', 'correct horse'),
    {
      load: async () => {
        throw new Error('storage is blocked');
      },
      save: async () => {},
      remove: async () => {}
    }
  );
  assert.equal(await blocked.isUnlocked(), false);

  // fetchDecrypted can insist on encryption for media known to be encrypted.
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(new Blob([pattern(9)]));
    assert.deepEqual(
      await bytesOf(await firstLoad.fetchDecrypted('https://cdn.example.test/plain')),
      pattern(9)
    );
    await assert.rejects(
      () => firstLoad.fetchDecrypted('https://cdn.example.test/plain', { requireEncrypted: true }),
      (error) => error.code === 'not_encrypted'
    );
  } finally {
    globalThis.fetch = realFetch;
  }
}

/**
 * The same input in two encrypted projects is uploaded once. The upload library
 * is told the hash of the ENCRYPTED file, which only this account can produce,
 * and never the hash of the plaintext or the file's name.
 */
async function checkEncryptedUploadReuse() {
  const client = stubClient({ savedUploads: true });
  const mediaEncryption = new MediaEncryptionApi(
    { client, eip712: {} },
    stubAccount('artist', 'correct horse'),
    new lib.MemoryAccountKeyStore()
  );
  await mediaEncryption.unlock('correct horse');
  const projects = new ProjectsApi({ client, eip712: {} }, mediaEncryption);
  const transfers = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    transfers.push({ url, body: await bytesOf(init.body) });
    return { ok: true, status: 200 };
  };
  const params = () => ({
    type: 'image',
    modelId: 'encryptable-model',
    positivePrompt: 'a lighthouse',
    numberOfMedia: 1,
    steps: 20,
    guidance: 7,
    mediaEncryption: true,
    // A fresh File each time, as a second visit to the page would produce.
    startingImage: new File([pattern(3000)], 'holiday-in-lisbon.png', { type: 'image/png' })
  });
  try {
    await projects.create(params());
    await projects.create(params());
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(transfers.length, 1, 'the second project reuses the first upload');
  assert.equal(lib.isEncryptedMedia(transfers[0].body), true, 'what is saved is ciphertext');
  const { prepared, bound } = client.library;
  assert.equal(prepared.length, 2);
  assert.equal(
    prepared[0].sha256,
    sha256(transfers[0].body),
    'it is the encrypted file that is hashed'
  );
  assert.equal(prepared[1].sha256, prepared[0].sha256, 'and that hash is the same every time');
  assert.notEqual(prepared[0].sha256, sha256(pattern(3000)), 'never the hash of the plaintext');
  assert.equal(prepared[0].bytes, transfers[0].body.length);
  assert.equal(prepared[0].contentType, 'image/png');
  assert.equal(JSON.stringify(prepared).includes('lisbon'), false, 'nor the name of the file');
  assert.deepEqual(
    bound.map((binding) => binding.type),
    ['startingImage', 'startingImage']
  );
  // Each project still sends the worker the key of that input, wrapped under its own project key.
  const [first, second] = client.sent.map((message) => message.data.mediaEncryption);
  const keyOf = async (field) =>
    hex(
      await lib.unwrapInputKey(lib.base64ToBytes(field.key), lib.base64ToBytes(field.inputKeys[0]))
    );
  assert.notEqual(first.key, second.key);
  assert.equal(await keyOf(first), await keyOf(second));
  const opened = await lib.decryptMedia(transfers[0].body, async () => unhex(await keyOf(second)));
  assert.deepEqual(await bytesOf(opened.data), pattern(3000));
}

async function checkProjectCreation() {
  const client = stubClient();
  const account = stubAccount('artist', 'correct horse');
  const mediaEncryption = new MediaEncryptionApi(
    { client, eip712: {} },
    account,
    new lib.MemoryAccountKeyStore()
  );
  const projects = new ProjectsApi({ client, eip712: {} }, mediaEncryption);
  const uploads = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    uploads.push({ url, init });
    return { ok: true, status: 200 };
  };
  const params = {
    type: 'image',
    modelId: 'encryptable-model',
    positivePrompt: 'a lighthouse',
    numberOfMedia: 1,
    steps: 20,
    guidance: 7,
    startingImage: new Blob([pattern(3000)], { type: 'image/png' }),
    contextImages: [new Blob([pattern(4000)], { type: 'image/jpeg' })]
  };
  try {
    assert.equal(await projects.supportsMediaEncryption('encryptable-model'), true);
    assert.equal(await projects.supportsMediaEncryption('plain-model'), false);
    assert.equal(await projects.supportsMediaEncryption('missing-model'), false);

    // Locked: refused before anything is uploaded or sent.
    await assert.rejects(
      () => projects.create({ ...params, mediaEncryption: true }),
      (error) => error.code === 'locked'
    );
    assert.equal(uploads.length, 0);
    assert.equal(client.sent.length, 0);

    await mediaEncryption.unlock('correct horse');
    await assert.rejects(
      () => projects.create({ ...params, modelId: 'plain-model', mediaEncryption: true }),
      (error) => error.code === 'unsupported'
    );
    await assert.rejects(
      () => projects.create({ ...params, startingImage: true, mediaEncryption: true }),
      (error) => error.code === 'unsupported' && /startingImage/.test(error.message)
    );
    await assert.rejects(
      () => projects.create({ ...params, contextImages: [true], mediaEncryption: true }),
      (error) => error.code === 'unsupported' && /contextImages/.test(error.message)
    );
    assert.equal(uploads.length, 0, 'nothing is uploaded for a refused project');

    const project = await projects.create({ ...params, mediaEncryption: true });
    assert.equal(project.encrypted, true);
    assert.equal(uploads.length, 2);
    for (const upload of uploads) {
      assert.equal(upload.init.method, 'PUT');
      const body = await bytesOf(upload.init.body);
      assert.equal(
        lib.isEncryptedMedia(body),
        true,
        'every upload of an encrypted project is ciphertext'
      );
      const opened = await mediaEncryption.decrypt(body);
      assert.ok(['image/png', 'image/jpeg'].includes(opened.type));
      assert.deepEqual(await bytesOf(opened), pattern(opened.type === 'image/png' ? 3000 : 4000));
    }
    const request = client.sent.at(-1);
    assert.equal(request.type, 'jobRequest');
    assert.equal(request.data.mediaEncryption.version, 1);
    // Every input opens with one of the input keys the worker is sent (wrapped under the
    // project key), and with nothing else: not the project key itself.
    const sentKey = lib.base64ToBytes(request.data.mediaEncryption.key);
    assert.equal(request.data.mediaEncryption.inputKeys.length, 2);
    const workerKeys = await Promise.all(
      request.data.mediaEncryption.inputKeys.map((wrapped) =>
        lib.unwrapInputKey(sentKey, lib.base64ToBytes(wrapped))
      )
    );
    for (const upload of uploads) {
      const body = await bytesOf(upload.init.body);
      const opened = await Promise.allSettled(
        workerKeys.map((key) => lib.decryptMedia(body, () => key))
      );
      assert.equal(opened.filter((result) => result.status === 'fulfilled').length, 1);
      await assert.rejects(
        () => lib.decryptMedia(body, () => sentKey),
        (error) => error.code === 'authentication_failed'
      );
    }
    assert.equal(
      projects._projectEncryption.size,
      0,
      'the project key is dropped once the request is sent'
    );
    assert.ok(client.savedUploadChecks.length > 0, 'encrypted uploads try the upload library too');

    // An unencrypted project is untouched.
    uploads.length = 0;
    const plain = await projects.create(params);
    assert.equal(plain.encrypted, false);
    assert.equal('mediaEncryption' in client.sent.at(-1).data, false);
    assert.equal(lib.isEncryptedMedia(await bytesOf(uploads[0].init.body)), false);
    assert.ok(client.savedUploadChecks.length > 0, 'ordinary uploads still try saved uploads');

    // Results: decrypted transparently, and a plaintext result on an encrypted project is an error.
    const sealedResult = await lib.encryptMedia(pattern(7000), {
      key: sentKey,
      contentType: 'image/png',
      recipient: lib.base64ToBytes(request.data.mediaEncryption.recipient)
    });
    const job = project._addJob({
      id: 'JOB-1',
      projectId: project.id,
      status: 'completed',
      step: 20,
      stepCount: 20,
      resultUrl: 'https://cdn.example.test/result'
    });
    assert.equal(job.encrypted, true);
    globalThis.fetch = async () => new Response(sealedResult);
    const result = await job.getResultData();
    assert.equal(result.type, 'image/png');
    assert.deepEqual(await bytesOf(result), pattern(7000));
    globalThis.fetch = async () => new Response(new Blob([pattern(7000)]));
    await assert.rejects(
      () => job.getResultData(),
      (error) => error.code === 'not_encrypted'
    );
  } finally {
    globalThis.fetch = realFetch;
  }

  await checkEncryptedUploadReuse();

  // Recovery: the recovered request marks the project encrypted without carrying a key.
  const recoveredRequest = {
    keyFrames: [{ modelID: 'encryptable-model', positivePrompt: 'a lighthouse' }],
    mediaEncryption: { version: 1, recipient: 'AAAA' }
  };
  const recovered = projectParamsFromRecoveredProject({
    id: 'RECOVERED',
    jobType: 'image',
    clientRequestData: Buffer.from(JSON.stringify(recoveredRequest)).toString('base64')
  });
  assert.equal(recovered.mediaEncryption, true);
  const plainRecovered = projectParamsFromRecoveredProject({
    id: 'RECOVERED-PLAIN',
    jobType: 'image',
    clientRequestData: Buffer.from(
      JSON.stringify({ keyFrames: [{ modelID: 'plain-model' }] })
    ).toString('base64')
  });
  assert.equal('mediaEncryption' in plainRecovered, false);
}

// MiniMax H3 keyframes have their own uploader (keyframeImage1..N); an encrypted
// project encrypts them like every other input and refuses a `true` placeholder.
async function checkEncryptedKeyframeUploads() {
  const H3_I2V = 'minimax-h3-fl2va-fp8_i2v';
  const client = stubClient();
  const realGet = client.socket.get;
  client.socket.get = async (requestPath) => {
    if (requestPath === '/api/v1/models/list') {
      return [
        ...(await realGet(requestPath)),
        {
          id: H3_I2V,
          name: 'H3 i2v',
          SID: 3,
          tier: 'video-tier',
          media: 'video',
          supportsMediaEncryption: true
        }
      ];
    }
    return realGet(requestPath);
  };
  const account = stubAccount('artist', 'correct horse');
  const mediaEncryption = new MediaEncryptionApi(
    { client, eip712: {} },
    account,
    new lib.MemoryAccountKeyStore()
  );
  await mediaEncryption.unlock('correct horse');
  const projects = new ProjectsApi({ client, eip712: {} }, mediaEncryption);
  projects.getModelOptions = async () => ({
    type: 'video',
    steps: { min: 20, max: 20, step: 1, default: 20 },
    guidance: { min: 1, max: 1, step: 1, default: 1 },
    fps: { allowed: [24], default: 24 },
    sampler: { allowed: [], default: null },
    scheduler: { allowed: ['simple'], default: 'simple' }
  });
  const uploads = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    uploads.push({ url, init });
    return { ok: true, status: 200 };
  };
  const params = (keyframeImage) => ({
    type: 'video',
    network: 'fast',
    modelId: H3_I2V,
    numberOfMedia: 1,
    positivePrompt: 'A continuous cinematic shot.',
    duration: 10,
    width: 1344,
    height: 768,
    steps: 20,
    guidance: 1,
    scheduler: 'simple',
    referenceImage: new Blob([pattern(3000)], { type: 'image/png' }),
    keyframes: [{ image: keyframeImage, frameIndex: 30 }],
    mediaEncryption: true
  });
  try {
    await assert.rejects(
      () => projects.create(params(true)),
      (error) => error.code === 'unsupported' && /keyframes/.test(error.message)
    );
    assert.equal(uploads.length, 0, 'nothing is uploaded for a refused project');
    const project = await projects.create(params(new Blob([pattern(5000)], { type: 'image/png' })));
    assert.equal(project.encrypted, true);
    assert.equal(uploads.length, 2, 'the start frame and the keyframe');
    for (const upload of uploads) {
      const body = await bytesOf(upload.init.body);
      assert.equal(lib.isEncryptedMedia(body), true, 'a keyframe upload is ciphertext too');
    }
    const request = client.sent.at(-1);
    assert.equal(request.data.mediaEncryption.inputKeys.length, 2);
    project._update({ status: 'failed', error: { code: 0, message: 'test cleanup' } });
  } finally {
    globalThis.fetch = realFetch;
  }
}

// The socket's refusal codes (sogni-socket constants/errorCodes.js). 4095 and
// 4097 belong to ordinary input-media errors there, so they must not be reused.
function checkErrorCodes() {
  assert.deepEqual(
    { ...MEDIA_ENCRYPTION_ERROR_CODES },
    { UNSUPPORTED: 4098, NO_WORKER_AVAILABLE: 4096, RESUME_FAILED: 4099 }
  );
}

// The server says per connection whether it accepts encrypted projects from
// this account; absent means no, and signing out forgets it.
async function checkServerAvailability() {
  const client = stubClient();
  const api = new MediaEncryptionApi(
    { client, eip712: {} },
    stubAccount('artist', 'correct horse'),
    new lib.MemoryAccountKeyStore()
  );
  const changes = [];
  api.on('availabilityChanged', (value) => changes.push(value));
  assert.equal(api.available, false, 'nothing said yet');
  client.socket.deliver('authenticated', { mediaEncryptionAvailable: true });
  assert.equal(api.available, true);
  client.socket.deliver('authenticated', {});
  assert.equal(api.available, false, 'a server that does not say means no');
  client.socket.deliver('authenticated', { mediaEncryptionAvailable: true });
  client.auth.emitUpdated(false);
  assert.equal(api.available, false, 'signing out forgets it');
  assert.deepEqual(changes, [true, false, true, false]);
}

// An account that signs in only with Google or Apple has no password to derive
// its key from: unlock says so instead of calling the password wrong.
async function checkProviderOnlyAccounts() {
  const make = (authMethods) =>
    new MediaEncryptionApi(
      { client: stubClient(), eip712: {} },
      stubAccount('artist', 'correct horse', { authMethods }),
      new lib.MemoryAccountKeyStore()
    );
  const ssoOnly = make(['sso-google']);
  assert.equal(await ssoOnly.canUnlockWithPassword(), false);
  await assert.rejects(
    () => ssoOnly.unlock('anything'),
    (error) => error.code === 'password_unavailable'
  );
  const linked = make(['password', 'sso-apple']);
  assert.equal(await linked.canUnlockWithPassword(), true);
  await assert.rejects(
    () => linked.unlock('wrong'),
    (error) => error.code === 'invalid_password'
  );
  await linked.unlock('correct horse');
  assert.equal(await linked.isUnlocked(), true);
  assert.equal(await make(undefined).canUnlockWithPassword(), true, 'older API: assume a password');
}

// A 4098 refusal means the cached model list was wrong about this model, so the
// next support check reads the list again instead of waiting out the cache.
async function checkUnsupportedRefusalRefreshesModels() {
  const client = stubClient();
  let listReads = 0;
  const realGet = client.socket.get;
  client.socket.get = async (requestPath) => {
    if (requestPath === '/api/v1/models/list') listReads++;
    return realGet(requestPath);
  };
  const projects = new ProjectsApi({ client, eip712: {} });
  await projects.supportsMediaEncryption('encryptable-model');
  await projects.supportsMediaEncryption('encryptable-model');
  assert.equal(listReads, 1, 'cached');
  projects.handleJobError({ jobID: 'P-1', error: 4096, error_message: 'busy' });
  await projects.supportsMediaEncryption('encryptable-model');
  assert.equal(listReads, 1, 'a capacity refusal does not refresh it');
  projects.handleJobError({ jobID: 'P-2', error: 4098, error_message: 'not available' });
  await projects.supportsMediaEncryption('encryptable-model');
  assert.equal(listReads, 2, 'an unsupported refusal does');
}

// Some runtimes an app imports the SDK into (jsdom test environments, older
// embedded engines) have no TextEncoder. Only media encryption needs one, so
// loading the SDK must not.
function checkLoadsWithoutTextCodecs() {
  const { spawnSync } = require('node:child_process');
  const script = [
    'delete globalThis.TextEncoder;',
    'delete globalThis.TextDecoder;',
    `require(${JSON.stringify(require.resolve('../dist/index.js'))});`,
    "process.stdout.write('loaded');"
  ].join('\n');
  const child = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' });
  assert.equal(child.stdout, 'loaded', child.stderr);
}

async function run() {
  checkErrorCodes();
  checkLoadsWithoutTextCodecs();
  await checkVectors();
  await checkRoundTripsAndTampering();
  await checkAccountKeyLifecycle();
  await checkKeyHygiene();
  await checkProjectCreation();
  await checkEncryptedKeyframeUploads();
  await checkServerAvailability();
  await checkProviderOnlyAccounts();
  await checkUnsupportedRefusalRefreshesModels();
  console.log('check-media-encryption: OK');
}

// ProjectsApi keeps liveness timers running, so exit explicitly.
run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('check-media-encryption: FAIL');
    console.error(error);
    process.exit(1);
  });
