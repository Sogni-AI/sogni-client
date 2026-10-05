/**
 * Regression check: inline data URIs over ~3 MB must parse in a long-running
 * process.
 *
 * Once a process has compiled about 1 MB of regexp code, V8 compiles every later
 * regexp without optimization (TooMuchRegExpCode). An unoptimized `[...]+` loop
 * takes 16 bytes of backtrack stack per character, so a regex over a whole
 * base64 payload throws "Maximum call stack size exceeded" past ~4.19M
 * characters. sogni-api hit exactly that in production on 2026-10-02..04 with
 * the parser this package shares. A fresh process never reaches that state, so
 * the large-payload checks run in a child process started with
 * `--no-regexp-optimization`, the mode V8 switches to on its own, and first
 * confirm the previous regexes overflow there.
 *
 * Runs against compiled `dist/` output, like the sibling check-* scripts.
 */

'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { EventEmitter } = require('node:events');

const DIST = path.resolve(__dirname, '../dist');
const { parseInlineMediaDataUri } = require(path.join(DIST, 'lib/mediaValidation.js'));
const ProjectsApi = require(path.join(DIST, 'Projects/index.js')).default;

// A PNG signature and IHDR declaring 2048x1152, padded to `size` bytes: all the
// image parser reads is the signature and the IHDR dimensions.
const PNG_HEAD_HEX = '89504e470d0a1a0a0000000d49484452000008000000048008020000000000000000';
function pngBytes(size) {
  const head = Buffer.from(PNG_HEAD_HEX, 'hex');
  return Buffer.concat([head, Buffer.alloc(size - head.length, 0x5a)]);
}

const MODEL_OPTIONS = {
  type: 'image',
  steps: { min: 1, max: 1, step: 1, default: 1 },
  guidance: { min: 0, max: 1, step: 0.1, default: 0 },
  sampler: { allowed: [], default: null },
  scheduler: { allowed: [], default: null }
};

// A ProjectsApi whose socket and uploads are stubbed; `uploads` collects the
// mask bytes create() uploads.
function stubProjects() {
  const client = new EventEmitter();
  client.socket = new EventEmitter();
  client.socket.send = async () => {};
  client.logger = { debug() {}, info() {}, warn() {}, error() {} };
  client.resolveWorkloadAttribution = () => undefined;
  const projects = new ProjectsApi({ client, eip712: {} });
  projects.getModelOptions = async () => MODEL_OPTIONS;
  const uploads = [];
  projects.uploadReferenceMask = async (id, media) =>
    uploads.push(Buffer.from(await media.arrayBuffer()));
  projects.uploadContextImage = async () => {};
  return { projects, uploads };
}

const maskParams = (gptImageMaskUrl) => ({
  type: 'image',
  modelId: 'gpt-image-2.5-flare',
  positivePrompt: 'Edit the first image',
  numberOfMedia: 1,
  width: 1024,
  height: 1024,
  sizePreset: 'custom',
  contextImages: [Buffer.from('reference')],
  gptImageMaskUrl,
  gptImageQuality: 'medium'
});

function verifyLargePayloadsWithoutRegexpOptimization() {
  const script = `
    const { EventEmitter } = require('node:events');
    const { parseInlineMediaDataUri } = require(${JSON.stringify(path.join(DIST, 'lib/mediaValidation.js'))});
    const ProjectsApi = require(${JSON.stringify(path.join(DIST, 'Projects/index.js'))}).default;
    const overflows = (pattern, input) => {
      try { pattern.exec(input); return false; } catch (error) { return /call stack/.test(error.message); }
    };
    (async () => {
      const head = Buffer.from(${JSON.stringify(PNG_HEAD_HEX)}, 'hex');
      const bytes = Buffer.concat([head, Buffer.alloc(3300000 - head.length, 0x5a)]);
      const uri = 'data:image/png;base64,' + bytes.toString('base64');

      const previousInlineRegexOverflowed = overflows(/^data:([^;,]+);base64,([A-Za-z0-9+/=\\s]+)$/i, uri);
      const parsed = parseInlineMediaDataUri(uri, 'image', { maxBytes: 20 * 1024 * 1024 });

      const previousMaskRegexOverflowed = overflows(/^data:image\\/png;base64,([A-Za-z0-9+/=]+)$/, uri);
      const client = new EventEmitter();
      client.socket = new EventEmitter();
      client.socket.send = async () => {};
      client.logger = { debug() {}, info() {}, warn() {}, error() {} };
      client.resolveWorkloadAttribution = () => undefined;
      const projects = new ProjectsApi({ client, eip712: {} });
      projects.getModelOptions = async () => (${JSON.stringify(MODEL_OPTIONS)});
      let maskBytes;
      projects.uploadReferenceMask = async (id, media) => { maskBytes = Buffer.from(await media.arrayBuffer()); };
      projects.uploadContextImage = async () => {};
      const params = ${JSON.stringify(maskParams(undefined))};
      await projects.create({ ...params, contextImages: [Buffer.from('reference')], gptImageMaskUrl: uri });

      process.stdout.write(JSON.stringify({
        previousInlineRegexOverflowed,
        byteLength: parsed.byteLength,
        imageDimensions: parsed.imageDimensions,
        previousMaskRegexOverflowed,
        maskUploadedIntact: Buffer.compare(maskBytes, bytes) === 0
      }));
      process.exit(0);
    })().catch((error) => { console.error(error); process.exit(1); });
  `;
  const child = spawnSync(process.execPath, ['--no-regexp-optimization', '-e', script], {
    encoding: 'utf8',
    timeout: 120_000
  });
  assert.equal(child.stderr, '', child.stderr);
  assert.equal(child.status, 0);
  const result = JSON.parse(child.stdout);
  // The child reproduces the production condition: the regexes both parsers
  // used to run over the payload overflow in this mode.
  assert.equal(result.previousInlineRegexOverflowed, true);
  assert.equal(result.previousMaskRegexOverflowed, true);
  assert.equal(result.byteLength, 3_300_000);
  assert.deepEqual(result.imageDimensions, { width: 2048, height: 1152 });
  assert.equal(result.maskUploadedIntact, true);
}

// parseInlineMediaDataUri accepts and rejects exactly what the previous
// pattern did; only a payload with characters outside base64 now fails with
// "Invalid base64 payload" (from decodeStrictBase64) instead of the generic
// message.
function verifyInlineParserBehaviour() {
  const bytes = pngBytes(64);
  const base64 = bytes.toString('base64');
  assert.deepEqual(
    parseInlineMediaDataUri(`data:image/png;base64,${base64}`, 'image').imageDimensions,
    {
      width: 2048,
      height: 1152
    }
  );
  assert.equal(
    parseInlineMediaDataUri(`  DATA:IMAGE/PNG;BASE64,${base64}\n`, 'image').mimeType,
    'image/png'
  );
  assert.equal(
    parseInlineMediaDataUri(
      `data:image/png;base64,${base64.replace(/(.{76})/g, '$1\r\n')}`,
      'image'
    ).byteLength,
    64
  );

  const notInline = /Only inline base64-encoded data URIs are supported for image inputs/;
  for (const input of [
    'https://media.sogni.ai/a.png',
    `data:image/png,${base64}`,
    `data:;base64,${base64}`,
    `data:image/png;x=1;base64,${base64}`,
    'data:image/png;base64,',
    `data:image/png;base64 ,${base64}`
  ]) {
    assert.throws(() => parseInlineMediaDataUri(input, 'image'), notInline, input.slice(0, 40));
  }
  for (const input of [
    `data:image/png;base64,${base64}!`,
    `data:image/png;base64,${base64},AAAA`
  ]) {
    assert.throws(() => parseInlineMediaDataUri(input, 'image'), /Invalid base64 payload/);
  }
}

// create() accepts and rejects exactly the mask data URIs the previous pattern did.
async function verifyMaskBehaviour() {
  const { projects, uploads } = stubProjects();
  const mask = pngBytes(64);
  const base64 = mask.toString('base64');
  await projects.create(maskParams(`data:image/png;base64,${base64}`));
  assert.deepEqual(uploads, [mask]);

  const rejected = /GPT Image mask must be a PNG data URI smaller than 50 MB/;
  for (const input of [
    'data:image/png;base64,',
    `data:IMAGE/png;base64,${base64}`,
    `data:image/png;BASE64,${base64}`,
    `data:image/jpeg;base64,${base64}`,
    `data:image/png;base64,${base64}\n`,
    `data:image/png;base64,${base64.slice(0, 40)} ${base64.slice(40)}`,
    `data:image/png;base64,${base64}!`,
    `data:image/png,${base64}`
  ]) {
    await assert.rejects(
      projects.create(maskParams(input)),
      rejected,
      JSON.stringify(input.slice(0, 40))
    );
  }
  assert.equal(uploads.length, 1);
}

verifyLargePayloadsWithoutRegexpOptimization();
verifyInlineParserBehaviour();
// create() leaves Project timers running; exit explicitly.
verifyMaskBehaviour().then(
  () => {
    console.log(
      'Inline media and GPT Image mask data URIs over 3 MB parse without regexp optimization; accept/reject unchanged'
    );
    process.exit(0);
  },
  (error) => {
    console.error(error);
    process.exit(1);
  }
);
