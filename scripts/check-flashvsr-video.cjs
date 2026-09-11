'use strict';
const assert = require('node:assert/strict');
const sdk = require('../dist/index.js');
const create = require('../dist/Projects/createJobRequestMessage.js').default;
const { calculateVideoFrames, getVideoAssetRequirements, getVideoWorkflowType } = require('../dist/Projects/utils/index.js');
const { mapVideoTier } = require('../dist/Projects/types/ModelOptions.js');
const modelId = 'flashvsr_v1.1_tiny_long_bf16';
// The server-advertised FlashVSR tier, as delivered in the model catalog.
const tier = {
  type: 'video', task: 'video-upscale', requiresReferenceVideo: true, preservesSourceTiming: true,
  outputResolutions: [1080, 1440], maxPixels: 3686400,
  width: { min: 2, max: 2560, step: 2, default: 2520 },
  height: { min: 2, max: 2560, step: 2, default: 1440 },
  frames: { min: 1, max: 362, step: 1, default: 158 },
  fps: { min: 1, max: 60, default: 24 },
  steps: { min: 1, max: 1, default: 1 },
  guidance: { min: 1, max: 1, default: 1 },
  comfySampler: { allowed: ['euler'], default: 'euler' },
  comfyScheduler: { allowed: ['simple'], default: 'simple' }
};
const options = mapVideoTier(tier);
const source = new Blob(['source'], { type: 'video/mp4' });
const request = (changes = {}) => create('00000000-0000-4000-8000-000000000003', {
  type: 'video', modelId, positivePrompt: '', numberOfMedia: 1,
  referenceVideo: source, width: 2520, height: 1440, frames: 158, fps: 24,
  steps: 1, ...changes
}, options);
assert.equal(sdk.FLASHVSR_VIDEO_UPSCALE_MODEL_ID, modelId);
assert.equal(sdk.isVideoModel(modelId), true);
assert.equal(sdk.isVideoUpscaleModel(modelId), true);
assert.equal(getVideoWorkflowType(modelId), 'upscale');
assert.equal(getVideoAssetRequirements(modelId).referenceVideo, 'required');
assert.deepEqual(options.outputResolutions, [1080, 1440]);
assert.equal(options.preservesSourceTiming, true);
assert.equal(calculateVideoFrames(modelId, 158 / 24, 24), 158);
const key = request({ duration: 5 }).keyFrames[0];
assert.equal(key.frames, 158, 'explicit source count must win over duration');
assert.equal(key.fps, 24);
assert.equal(key.hasReferenceVideo, true);
assert.equal(key.generateAudio, true);
assert.equal(key.interpolation, 'none');
assert.equal(key.upscaleResolution, 1440);
assert.equal(request({ width: 1890, height: 1080 }).keyFrames[0].upscaleResolution, 1080);
assert.equal(request({ fps: 24000 / 1001 }).keyFrames[0].fps, 24000 / 1001);
assert.throws(() => request({ width: 3780, height: 2160 }), /1080p or 1440p/);
assert.throws(() => request({ referenceVideo: undefined }), /requires referenceVideo/);
assert.throws(() => request({ referenceImage: new Blob(['image']) }), /does not support referenceImage/);
assert.throws(() => request({ positivePrompt: 'replace the face' }), /promptless/);
for (const changes of [{ teacacheThreshold: 0 }, { trimEndFrame: true }, { generateAudio: false }, { numberOfMedia: 2 }]) {
  assert.throws(() => request(changes));
}
// Minimal call: the server adopts the verified source frames, rate and size.
const minimal = create('00000000-0000-4000-8000-000000000004', {
  type: 'video', modelId, positivePrompt: '', numberOfMedia: 1,
  referenceVideo: source, upscaleResolution: 1080
}, options).keyFrames[0];
assert.equal(minimal.upscaleResolution, 1080);
assert.equal(minimal.hasReferenceVideo, true);
for (const key of ['frames', 'fps', 'width', 'height']) {
  assert.equal(minimal[key], undefined, `minimal upscale must leave ${key} to the verified source`);
}
assert.equal(minimal.steps, 1);
assert.equal(minimal.seed, 0);
const rateOnly = request({ width: undefined, height: undefined, frames: undefined, upscaleResolution: 1440, fps: 30000 / 1001 }).keyFrames[0];
assert.equal(rateOnly.fps, 30000 / 1001);
assert.equal(rateOnly.frames, undefined);
assert.throws(() => request({ frames: undefined, fps: undefined, duration: 5 }), /exact frame count and frame rate/);
assert.throws(() => request({ frames: 363 }), /exact frame count and frame rate/);
assert.throws(() => request({ fps: 120 }), /exact frame count and frame rate/);
assert.throws(() => request({ width: undefined, height: undefined, upscaleResolution: undefined }), /1080p or 1440p/);
console.log('FlashVSR SDK upload, timing, resolution, promptless and catalog checks passed.');

// An unset optional query param must be omitted, not sent as "undefined": the API
// keys the uploaded source by `id`, and a literal "undefined" id hid FlashVSR
// sources from admission.
(async () => {
  const RestClient = require('../dist/lib/RestClient.js').default;
  const urls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    urls.push(new URL(String(url)));
    return new Response(JSON.stringify({ status: 'success', data: { uploadUrl: 'https://upload' } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };
  try {
    const auth = { authenticateRequest: async (options) => options };
    const logger = { debug() {}, info() {}, warn() {}, error() {} };
    const rest = new RestClient('https://api.example', auth, logger);
    await rest.get('/v1/media/uploadUrl', { jobId: 'job-1', type: 'referenceVideo', id: undefined, contentType: 'video/mp4', note: null, frames: 158 });
    const query = urls.at(-1).searchParams;
    assert.equal(query.has('id'), false, 'an unset id must not reach the API');
    assert.equal(query.has('note'), false);
    assert.equal(query.get('type'), 'referenceVideo');
    assert.equal(query.get('frames'), '158');
  } finally {
    globalThis.fetch = realFetch;
  }
  console.log('FlashVSR upload query checks passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
