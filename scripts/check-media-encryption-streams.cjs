'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const lib = require('../dist/lib/mediaEncryption/index.js');
const { openRemoteEncryptedMedia } = require('../dist/lib/mediaEncryption/remote.js');
const MediaEncryptionApi = require('../dist/MediaEncryption/index.js').default;

const key = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const data = Uint8Array.from({ length: 4 * 65536 + 131 }, (_, i) => (i * 31 + (i >>> 9)) & 255);
const nativeFetch = globalThis.fetch;
const url = 'https://storage.invalid/own-encrypted-test';

async function fixture(contentType = 'video/mp4', plaintext = data, recipient) {
  return new Uint8Array(await (await lib.encryptMedia(plaintext, {
    key, recipient, contentType, segmentSizeLog2: 16
  })).arrayBuffer());
}

function storage(bytes, transform = (response) => response) {
  const calls = [];
  globalThis.fetch = async (requestUrl, init) => {
    assert.equal(requestUrl, url);
    assert.equal(init.method, 'GET');
    assert.equal(init.cache, 'no-store');
    assert.equal(init.body, undefined);
    const range = /^bytes=(\d+)-(\d+)$/.exec(new Headers(init.headers).get('range'));
    assert.ok(range, 'request is a single exact range');
    const start = Number(range[1]);
    const end = Math.min(Number(range[2]) + 1, bytes.length);
    calls.push({ start, end, signal: init.signal });
    const response = new Response(bytes.slice(start, end), {
      status: 206,
      headers: { 'Content-Range': `bytes ${start}-${end - 1}/${bytes.length}` }
    });
    return transform(response, calls.length, init);
  };
  return calls;
}

function api() {
  const auth = new EventEmitter();
  auth.sessionVersion = 1;
  auth.isAuthenticated = true;
  const client = { auth, socket: new EventEmitter(), logger: { warn() {} } };
  return { auth, media: new MediaEncryptionApi({ client, eip712: {} }) };
}

async function main() {
  const bytes = await fixture();
  const calls = storage(bytes);
  const opened = await openRemoteEncryptedMedia(url, async () => key);
  assert.equal(opened.contentType, 'video/mp4');
  assert.equal(opened.size, data.length);
  assert.equal(calls.length, 3, 'only header and first/last segments are fetched on open');
  assert.ok(calls.every((call) => call.end - call.start <= 65536 + 16));
  assert.deepEqual(await opened.read(65530, 65546), data.slice(65530, 65546));
  assert.deepEqual(await opened.read(data.length - 50, data.length), data.slice(-50));
  assert.deepEqual(await opened.read(0, 0), new Uint8Array());
  assert.deepEqual(key, Uint8Array.from({ length: 32 }, (_, i) => i + 1), 'caller key is not modified');
  const count = calls.length;
  const stream = opened.stream(0, data.length).getReader();
  assert.equal(calls.length, count, 'stream does not prefetch before consumption');
  const first = await stream.read();
  assert.deepEqual(first.value, data.slice(0, 65536));
  assert.equal(calls.length, count + 1, 'one consumer pull fetches exactly one segment');
  await stream.cancel();
  assert.equal(calls.length, count + 1, 'cancel does not fetch the rest');
  for (const pair of [[-1, 2], [0, data.length + 1], [4, 3], [0.5, 4], [0, Infinity]]) {
    await assert.rejects(() => opened.read(...pair), RangeError);
  }
  opened.close();
  await assert.rejects(() => opened.read(0, 1), { name: 'AbortError' });

  for (const contentType of ['audio/mpeg', 'audio/wav', 'audio/flac', 'video/mp4']) {
    storage(await fixture(contentType));
    const source = await openRemoteEncryptedMedia(url, async () => key);
    assert.equal(source.contentType, contentType);
    assert.deepEqual(new Uint8Array(await new Response(source.stream()).arrayBuffer()), data);
    source.close();
  }
  storage(await fixture('audio/wav', new Uint8Array()));
  const empty = await openRemoteEncryptedMedia(url, async () => key);
  assert.equal(empty.size, 0);
  assert.equal((await new Response(empty.stream()).arrayBuffer()).byteLength, 0);
  empty.close();

  const header = lib.parseHeader(bytes);
  for (const altered of [
    bytes.slice(0, header.bytes.length + 2 * (65536 + 16)),
    new Uint8Array([...bytes, 1]),
    Uint8Array.from(bytes, (b, i) => i === 50 ? b ^ 1 : b),
    Uint8Array.from(bytes, (b, i) => i === bytes.length - 1 ? b ^ 1 : b)
  ]) {
    storage(altered);
    await assert.rejects(() => openRemoteEncryptedMedia(url, async () => key),
      (error) => ['authentication_failed', 'malformed'].includes(error.code));
  }
  storage(bytes);
  await assert.rejects(() => openRemoteEncryptedMedia(url, async () => new Uint8Array(32)),
    { code: 'authentication_failed' });
  const tampered = bytes.slice();
  tampered[header.bytes.length + 2 * (65536 + 16) + 30] ^= 1;
  storage(tampered);
  const damaged = await openRemoteEncryptedMedia(url, async () => key);
  await assert.rejects(() => damaged.read(2 * 65536, 2 * 65536 + 1), { code: 'authentication_failed' });
  damaged.close();

  for (const transform of [
    () => new Response(bytes),
    () => new Response(bytes.slice(0, 10), { status: 206 }),
    (response) => { response.headers.set('Content-Range', `bytes 1-819/${bytes.length}`); return response; },
    (response) => { response.headers.set('Content-Encoding', 'gzip'); return response; },
    (response, count) => { if (count > 1) response.headers.set('Content-Range', `bytes 0-818/${bytes.length + 1}`); return response; },
    (response) => new Response(bytes.slice(0, 820), { status: 206, headers: response.headers })
  ]) {
    storage(bytes, transform);
    await assert.rejects(() => openRemoteEncryptedMedia(url, async () => key));
  }

  const { media, auth } = api();
  await media.setAccountKey(key);
  const accountKey = await lib.importAccountKey(key);
  const recipient = await lib.wrapProjectKey(accountKey, key);
  const accountBytes = await fixture('audio/mpeg', data, recipient);
  storage(accountBytes);
  const playback = await media.openDecrypted(url);
  assert.deepEqual(await playback.read(65536, 65636), data.slice(65536, 65636));
  let beginRequest;
  const began = new Promise((resolve) => { beginRequest = resolve; });
  globalThis.fetch = async (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    beginRequest();
  });
  const pending = playback.read(0, 10);
  await began;
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  auth.sessionVersion++;
  auth.emit('sessionChanged');
  await rejected;
  await assert.rejects(() => playback.read(0, 10), { name: 'AbortError' });
  assert.equal(media.mediaReaders.size, 0, 'logout releases reader ownership');

  storage(accountBytes);
  await assert.rejects(() => media.openDecrypted(url), { code: 'locked' });
  assert.equal(media.mediaReaders.size, 0, 'failed open releases reader ownership');
  await media.setAccountKey(key);
  const aborter = new AbortController();
  const cancellable = await media.openDecrypted(url, { init: { signal: aborter.signal } });
  aborter.abort();
  await assert.rejects(() => cancellable.read(0, 10), { name: 'AbortError' });
  assert.equal(media.mediaReaders.size, 0);
  console.log('check-media-encryption-streams: PASS (seek, backpressure, media MIME, tamper/truncation, range validation, cancellation and account changes)');
}

// A promise that never settles drains the event loop, which would otherwise exit 0 unseen.
process.exitCode = 1;
main().then(() => { process.exitCode = 0; }, (error) => { console.error(error); process.exitCode = 1; }).finally(() => {
  globalThis.fetch = nativeFetch;
});
