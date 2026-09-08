'use strict';

const assert = require('node:assert/strict');
const sdk = require('../dist/index.js');

// The four consuming surfaces (api, chat, web, creative-agent-skill) must be able
// to ask the SDK what a model does instead of hardcoding id strings.
for (const name of [
  'PIXAL3D_IMAGE_TO_3D_MODEL_ID',
  'SAM3_IMAGE_SEGMENT_MODEL_ID',
  'isModelArtifactModel',
  'isSegmentationModel',
  'requiresStartingImage',
  'isVideoModel',
  'isAudioModel'
]) {
  assert.ok(sdk[name] !== undefined, `${name} is not exported from the package root`);
}

assert.equal(sdk.PIXAL3D_IMAGE_TO_3D_MODEL_ID, 'pixal3d_int8_i23d');
assert.equal(sdk.SAM3_IMAGE_SEGMENT_MODEL_ID, 'sam3_image_segment_bf16');

assert.equal(sdk.isModelArtifactModel(sdk.PIXAL3D_IMAGE_TO_3D_MODEL_ID), true);
assert.equal(sdk.isModelArtifactModel(sdk.SAM3_IMAGE_SEGMENT_MODEL_ID), false);
assert.equal(sdk.isSegmentationModel(sdk.SAM3_IMAGE_SEGMENT_MODEL_ID), true);
assert.equal(sdk.isSegmentationModel(sdk.PIXAL3D_IMAGE_TO_3D_MODEL_ID), false);

// Both transform a source image, so neither can run from a prompt alone.
assert.equal(sdk.requiresStartingImage(sdk.PIXAL3D_IMAGE_TO_3D_MODEL_ID), true);
assert.equal(sdk.requiresStartingImage(sdk.SAM3_IMAGE_SEGMENT_MODEL_ID), true);
assert.equal(sdk.requiresStartingImage('z_image_turbo_bf16'), false);

// Segmentation is not a generated image and must not be classified as one.
assert.equal(sdk.isVideoModel(sdk.SAM3_IMAGE_SEGMENT_MODEL_ID), false);
assert.equal(sdk.isAudioModel(sdk.SAM3_IMAGE_SEGMENT_MODEL_ID), false);

console.log('SDK capability export checks passed');
