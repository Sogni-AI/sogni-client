/**
 * Regression check: an image slot never uploads text in place of image bytes.
 *
 * Text in an image slot cannot be decoded as an image: a file path string, an
 * HTML page fetched in place of an image, or base64 text.
 * Each must be refused before any upload URL, PUT or jobRequest, with a
 * message naming the slot. Image bytes, SVG markup and anything the SDK does
 * not recognise still upload exactly as before.
 *
 * Runs against compiled `dist/` output, like the sibling check-* scripts.
 */

'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const DIST = path.resolve(__dirname, '../dist');
const ProjectsApi = require(path.join(DIST, 'Projects/index.js')).default;

const UPLOAD_URL = 'https://storage.example.test/presigned-put';

const MODEL_OPTIONS = {
  type: 'image',
  steps: { min: 1, max: 50, step: 1, default: 10 },
  guidance: { min: 0, max: 10, step: 0.1, default: 1 },
  sampler: { allowed: [], default: null },
  scheduler: { allowed: [], default: null }
};

const PNG = Buffer.concat([
  Buffer.from('89504e470d0a1a0a0000000d494844520000040000000400080200000000', 'hex'),
  crypto.randomBytes(256)
]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.randomBytes(256)]);
// Base64 text, labelled as a PNG the way a canvas export is.
const BASE64_TEXT = crypto.randomBytes(3000).toString('base64');

function stubProjects() {
  const requests = [];
  const puts = [];
  const sent = [];
  const client = new EventEmitter();
  client.socket = new EventEmitter();
  client.socket.send = async (type, data) => {
    sent.push({ type, data });
  };
  client.logger = { debug() {}, info() {}, warn() {}, error() {} };
  client.resolveWorkloadAttribution = () => undefined;
  client.rest = {
    get: async (requestPath, params) => {
      requests.push({ requestPath, params });
      if (requestPath === '/v1/assets/capabilities') return { data: { enabled: false } };
      if (requestPath === '/v1/image/uploadUrl') return { data: { uploadUrl: UPLOAD_URL } };
      throw new Error(`unexpected GET ${requestPath}`);
    },
    post: async (requestPath) => {
      throw new Error(`unexpected POST ${requestPath}`);
    }
  };
  const projects = new ProjectsApi({ client, eip712: {} });
  projects.getModelOptions = async () => MODEL_OPTIONS;
  return { projects, requests, puts, sent };
}

async function withFetch(puts, run) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, UPLOAD_URL);
    assert.equal(init.method, 'PUT');
    puts.push(init);
    return { ok: true, status: 200 };
  };
  try {
    return await run();
  } finally {
    globalThis.fetch = realFetch;
  }
}

async function bodyBytes(body) {
  if (typeof body === 'string') return Buffer.from(body, 'utf8');
  if (body instanceof Blob) return Buffer.from(await body.arrayBuffer());
  return Buffer.from(body);
}

// Every private upload helper that fills an image slot, with the label its error uses.
const IMAGE_SLOTS = [
  ['Guide image', (p, file) => p.uploadGuideImage('project-guide', file)],
  ['ControlNet image', (p, file) => p.uploadCNImage('project-cn', file)],
  ['Context image 1', (p, file) => p.uploadContextImage('project-context', 0, file)],
  ['Context image 2', (p, file) => p.uploadContextImage('project-context', 1, file)],
  ['Keyframe image 1', (p, file) => p.uploadKeyframeImage('project-keyframe', 1, file)],
  ['Reference image', (p, file) => p.uploadReferenceImage('project-reference', file)],
  ['Reference mask', (p, file) => p.uploadReferenceMask('project-mask', file)],
  ['End reference image', (p, file) => p.uploadReferenceImageEnd('project-end', file)]
];

const REFUSED = [
  [
    'base64 text in a PNG-typed Blob',
    () => new Blob([BASE64_TEXT], { type: 'image/png' }),
    /base64 text/
  ],
  ['base64 text in a Buffer', () => Buffer.from(BASE64_TEXT, 'ascii'), /base64 text/],
  [
    'a data: URL in a Blob',
    () => new Blob([`data:image/png;base64,${PNG.toString('base64')}`]),
    /data: URL/
  ],
  ['a data: URL string', () => `data:image/png;base64,${PNG.toString('base64')}`, /data: URL/],
  ['a base64 string', () => PNG.toString('base64'), /base64 text/],
  ['a file path string', () => 'D:\\photos\\portrait.png', /it is a string, not the file/],
  [
    'an HTML page in a Uint8Array',
    () => new Uint8Array(Buffer.from('<!doctype html><html><head><title>Not found</title>')),
    /HTML page/
  ],
  [
    'an HTML page with a BOM',
    () => Buffer.from('\ufeff\n  <HTML lang="en"><body>Sign in</body></HTML>', 'utf8'),
    /HTML page/
  ]
];

// Bodies that reach the PUT unchanged, as they did before the check existed.
const UPLOADED = [
  ['a PNG Buffer', () => PNG],
  ['a JPEG Blob', () => new Blob([JPEG], { type: 'image/jpeg' })],
  ['a PNG Uint8Array', () => new Uint8Array(PNG)],
  [
    'a GIF Buffer',
    () => Buffer.concat([Buffer.from('GIF89aAAAA', 'ascii'), crypto.randomBytes(64)])
  ],
  ['an SVG string', () => '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>'],
  [
    'an SVG Blob with an XML prolog',
    () =>
      new Blob(['<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>'], {
        type: 'image/svg+xml'
      })
  ],
  [
    'bytes the SDK does not recognise',
    () => Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x0c]), crypto.randomBytes(64)])
  ],
  ['a short text Buffer', () => Buffer.from('reference')]
];

async function checkSlots() {
  for (const [label, upload] of IMAGE_SLOTS) {
    for (const [name, makeBody, reason] of REFUSED) {
      const { projects, requests, puts } = stubProjects();
      await withFetch(puts, async () => {
        await assert.rejects(
          () => upload(projects, makeBody()),
          (error) => {
            assert.equal(error.status, 400, `${label}, ${name}: refused as a request error`);
            assert.match(
              error.message,
              new RegExp(`^${label} is not image data`),
              `${label}, ${name}: names the slot`
            );
            assert.match(error.message, reason, `${label}, ${name}: says what was found`);
            return true;
          },
          `${label} refuses ${name}`
        );
      });
      assert.equal(puts.length, 0, `${label}: ${name} is never PUT`);
      assert.equal(
        requests.filter((request) => request.requestPath === '/v1/image/uploadUrl').length,
        0,
        `${label}: ${name} never asks for an upload URL`
      );
    }
    for (const [name, makeBody] of UPLOADED) {
      const { projects, puts } = stubProjects();
      const body = makeBody();
      await withFetch(puts, () => upload(projects, body));
      assert.equal(puts.length, 1, `${label}: ${name} is uploaded`);
      assert.deepEqual(
        await bodyBytes(puts[0].body),
        await bodyBytes(body),
        `${label}: ${name} is uploaded byte for byte`
      );
    }
  }
}

// A file the browser can no longer read is left to fail where it always did.
async function checkUnreadableFileKeepsItsFailure() {
  class UnreadableBlob extends Blob {
    slice() {
      return { arrayBuffer: () => Promise.reject(new Error('NotReadableError')) };
    }
  }
  const { projects, puts } = stubProjects();
  const file = new UnreadableBlob(['x'.repeat(64)], { type: 'image/png' });
  await withFetch(puts, () => projects.uploadContextImage('project-unreadable', 0, file));
  assert.equal(puts.length, 1, 'an unreadable file still goes to the PUT, which reports it');
  assert.equal(puts[0].body, file);
}

const krea2Params = (contextImages) => ({
  type: 'image',
  modelId: 'krea2_identity_edit_v1_2',
  positivePrompt: 'Same person, studio portrait',
  numberOfMedia: 1,
  width: 1024,
  height: 1024,
  sizePreset: 'custom',
  tokenType: 'spark',
  contextImages
});

// End to end: nothing is sent, so nothing is charged.
async function checkCreateRefusesBeforeSubmitting() {
  const { projects, requests, puts, sent } = stubProjects();
  await withFetch(puts, async () => {
    await assert.rejects(
      () => projects.create(krea2Params([new Blob([BASE64_TEXT], { type: 'image/png' })])),
      (error) => {
        assert.match(
          error.message,
          /^Context image 1 is not image data: its contents are base64 text/
        );
        return true;
      }
    );
  });
  assert.equal(puts.length, 0, 'create() uploads nothing');
  assert.equal(
    sent.filter((message) => message.type === 'jobRequest').length,
    0,
    'create() sends no jobRequest'
  );
  assert.equal(
    requests.filter((request) => request.requestPath === '/v1/image/uploadUrl').length,
    0
  );

  const accepted = stubProjects();
  await withFetch(accepted.puts, () => accepted.projects.create(krea2Params([PNG])));
  assert.equal(accepted.puts.length, 1, 'a real image is uploaded');
  assert.equal(accepted.sent.filter((message) => message.type === 'jobRequest').length, 1);
}

(async () => {
  await checkSlots();
  await checkUnreadableFileKeepsItsFailure();
  await checkCreateRefusesBeforeSubmitting();
  console.log(
    `Image upload body checks passed (${IMAGE_SLOTS.length} slots x ${REFUSED.length} refused, ${UPLOADED.length} uploaded)`
  );
  // The accepted project keeps its liveness timers running.
  process.exit(0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
