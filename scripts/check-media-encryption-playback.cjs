'use strict';
const assert = require('node:assert/strict');
const { createEncryptedPlayback, serveEncryptedMedia, encryptedMediaResponse, ENCRYPTED_MEDIA_CHUNK_BYTES } = require('../dist/browser/mediaEncryptionPlayback/index.js');

async function main() {
  let listener;
  const worker = { postMessage(_, ports) { ports[0].postMessage({ clientId: 'owner' }); ports[0].close(); } };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { serviceWorker: {
    controller: worker,
    addEventListener(_, callback) { listener = callback; },
    removeEventListener() { listener = undefined; }
  } } });
  globalThis.location = { origin: 'https://app.invalid' };
  const getClient = async () => ({ postMessage(data, ports) { listener?.({ source: worker, data, ports }); } });
  const bytes = Uint8Array.from({ length: 2 * ENCRYPTED_MEDIA_CHUNK_BYTES + 19 }, (_, i) => i % 251);
  let reads = [], closes = 0;
  const reader = { size: bytes.length, contentType: 'video/mp4', async read(start, end) { reads.push([start, end]); return bytes.slice(start, end); }, close() { closes++; } };
  const playback = await createEncryptedPlayback(reader);
  for (const [range, start, end] of [
    ['bytes=1048570-1048590', 1048570, 1048591],
    ['bytes=-12', bytes.length - 12, bytes.length],
    ['bytes=2097150-', 2097150, bytes.length]
  ]) {
    const response = await serveEncryptedMedia(new Request(playback.url, { headers: { Range: range } }), 'owner', getClient);
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(response.headers.get('Content-Range'), `bytes ${start}-${end - 1}/${bytes.length}`);
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes.slice(start, end));
  }
  const before = reads.length;
  assert.equal((await serveEncryptedMedia(new Request(playback.url), 'other-tab', getClient)).status, 404);
  assert.equal(reads.length, before);
  const response = await serveEncryptedMedia(new Request(playback.url), 'owner', getClient);
  assert.equal(reads.length, before, 'response does not prefetch');
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
  assert.ok(reads.every(([start, end]) => end - start <= ENCRYPTED_MEDIA_CHUNK_BYTES));
  const active = await serveEncryptedMedia(new Request(playback.url), 'owner', getClient);
  playback.dispose();
  await assert.rejects(active.arrayBuffer());
  assert.equal(closes, 1);
  assert.equal((await serveEncryptedMedia(new Request(playback.url), 'owner', getClient)).status, 410);
  const abort = new AbortController();
  abort.abort();
  assert.equal((await serveEncryptedMedia(new Request(playback.url, { signal: abort.signal }), 'owner', getClient)).status, 410);
  for (const range of ['bytes=999999999-', 'bytes=2-1', 'bytes=-0', 'bytes=0-1,3-4', 'items=0-1']) {
    assert.equal(encryptedMediaResponse(new Request(playback.url, { headers: { Range: range } }), reader).status, 416);
  }
  const truncated = { ...reader, async read() { return new Uint8Array(1); } };
  await assert.rejects(encryptedMediaResponse(new Request(playback.url), truncated).arrayBuffer(), /Incomplete media range/);
  console.log('Encrypted playback bridge: bounded ranges, seeks, tab ownership, cancel/lock, malformed responses passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
