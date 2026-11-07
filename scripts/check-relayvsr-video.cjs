'use strict';
const assert = require('node:assert/strict');
const sdk = require('../dist/index.js');
const create = require('../dist/Projects/createJobRequestMessage.js').default;
const { calculateVideoFrames, getVideoAssetRequirements, getVideoWorkflowType } = require('../dist/Projects/utils/index.js');
const { mapVideoTier } = require('../dist/Projects/types/ModelOptions.js');
const { isComfyModel } = require('../dist/lib/validation.js');
const flashVsr = 'flashvsr_v1.1_tiny_long_bf16';
const x2 = 'relayvsr_x2_lightx2v_int8_convrot';
const x4 = 'relayvsr_x4_int8_convrot';
// The server-advertised RelayVSR tier, as delivered in the model catalog.
const tier = {
  type: 'video', task: 'video-upscale', requiresReferenceVideo: true, preservesSourceTiming: true,
  outputResolutions: [1080, 1440, 2160], maxPixels: 8294400,
  width: { min: 2, max: 3840, step: 2, default: 3840 },
  height: { min: 2, max: 3840, step: 2, default: 2160 },
  fps: { min: 1, max: 60, default: 24 },
  frames: { min: 1, max: 900, default: 158 },
  steps: { min: 1, max: 1, default: 1 },
  guidance: { min: 1, max: 1, default: 1 },
  comfySampler: { allowed: ['euler'], default: 'euler' },
  comfyScheduler: { allowed: ['simple'], default: 'simple' }
};
const options = mapVideoTier(tier);
const source = new Blob(['source'], { type: 'video/mp4' });
const request = (modelId, changes = {}) => create('00000000-0000-4000-8000-000000000005', {
  type: 'video', modelId, positivePrompt: '', numberOfMedia: 1,
  referenceVideo: source, upscaleResolution: 2160, ...changes
}, options);

assert.equal(sdk.RELAYVSR_X2_VIDEO_UPSCALE_MODEL_ID, x2);
assert.equal(sdk.RELAYVSR_X4_VIDEO_UPSCALE_MODEL_ID, x4);
assert.deepEqual(options.outputResolutions, [1080, 1440, 2160]);
for (const modelId of [x2, x4]) {
  assert.equal(sdk.isRelayVsrModel(modelId), true);
  assert.equal(sdk.isVideoModel(modelId), true);
  assert.equal(sdk.isVideoUpscaleModel(modelId), true);
  assert.equal(isComfyModel(modelId), true);
  assert.equal(getVideoWorkflowType(modelId), 'upscale');
  assert.equal(getVideoAssetRequirements(modelId).referenceVideo, 'required');
  assert.equal(calculateVideoFrames(modelId, 158 / 24, 24), 158);

  // Minimal call: the server adopts the verified source frames, rate and size.
  const key = request(modelId).keyFrames[0];
  assert.equal(key.upscaleResolution, 2160);
  assert.equal(key.hasReferenceVideo, true);
  assert.equal(key.steps, 1);
  assert.equal(key.seed, 0);
  assert.equal(key.generateAudio, true);
  assert.equal(key.interpolation, 'none');
  for (const field of ['frames', 'fps', 'width', 'height', 'detailPreference', 'processingSpeed']) {
    assert.equal(key[field], undefined, `RelayVSR must not send ${field} on a minimal call`);
  }
  for (const upscaleResolution of [1080, 1440, 2160]) {
    assert.equal(request(modelId, { upscaleResolution }).keyFrames[0].upscaleResolution, upscaleResolution);
  }
  assert.equal(request(modelId, { upscaleResolution: undefined, width: 3840, height: 2160 }).keyFrames[0].upscaleResolution, 2160);

  for (const changes of [
    { detailPreference: 'stable' }, { detailPreference: 'sharper' },
    { processingSpeed: 'stable' }, { processingSpeed: 'faster' },
    { seed: 0 }, { seed: 42 }, { seed: -1 }
  ]) assert.throws(() => request(modelId, changes), /RelayVSR has no/);
  assert.throws(() => request(modelId, { upscaleResolution: 720 }), /1080p, 1440p or 2160p/);
  assert.throws(() => request(modelId, { upscaleResolution: 2880 }), /1080p, 1440p or 2160p/);
  assert.throws(() => request(modelId, { referenceVideo: undefined }), /requires referenceVideo/);
  assert.throws(() => request(modelId, { positivePrompt: 'sharpen the face' }), /RelayVSR is promptless/);
  assert.throws(() => request(modelId, { negativePrompt: 'blur' }), /RelayVSR is promptless/);
  assert.throws(() => request(modelId, { referenceImage: new Blob(['image']) }), /does not support referenceImage/);
  for (const changes of [{ teacacheThreshold: 0 }, { trimEndFrame: true }, { generateAudio: false }, { numberOfMedia: 2 }]) {
    assert.throws(() => request(modelId, changes));
  }
  // No client-side length cap: the server's admission check alone refuses a long source.
  assert.equal(request(modelId, { frames: 1800, fps: 30 }).keyFrames[0].frames, 1800);
}
console.log('RelayVSR SDK model, resolution, option and promptless checks passed.');

// FlashVSR is unchanged by RelayVSR: its 2160 refusal, options and wire shape stay put.
const flash = (changes = {}) => create('00000000-0000-4000-8000-000000000006', {
  type: 'video', modelId: flashVsr, positivePrompt: '', numberOfMedia: 1,
  referenceVideo: source, upscaleResolution: 1440, ...changes
}, mapVideoTier({ ...tier, outputResolutions: [1080, 1440] }));
assert.equal(sdk.isRelayVsrModel(flashVsr), false);
assert.throws(() => flash({ upscaleResolution: 2160 }), (error) => error.message === 'Choose 1080p or 1440p for video upscaling.');
const flashKey = flash({ seed: 42, detailPreference: 'sharper', processingSpeed: 'faster' }).keyFrames[0];
assert.equal(flashKey.seed, 42);
assert.equal(flashKey.detailPreference, 'sharper');
assert.equal(flashKey.processingSpeed, 'faster');
assert.equal(flash().keyFrames[0].detailPreference, 'stable');
assert.equal(flash().keyFrames[0].processingSpeed, 'stable');
assert.throws(() => flash({ positivePrompt: 'x' }), (error) => error.message === 'FlashVSR is promptless.');
console.log('FlashVSR request shape is unchanged.');

// Hosted tool: FlashVSR stays the default; RelayVSR is opt-in by selector.
const tool = sdk.SogniTools.upscaleVideo.function;
assert.deepEqual(tool.parameters.properties.model.enum, ['flashvsr', 'relayvsr']);
assert.deepEqual(tool.parameters.properties.targetResolution.enum, [1080, 1440, 2160]);
assert.deepEqual(tool.parameters.required, []);
console.log('RelayVSR hosted tool checks passed.');
