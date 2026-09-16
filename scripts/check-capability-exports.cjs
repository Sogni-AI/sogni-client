'use strict';

const assert = require('node:assert/strict');
const sdk = require('../dist/index.js');

// The four consuming surfaces (api, chat, web, creative-agent-skill) must be able
// to ask the SDK what a model does instead of hardcoding id strings.
for (const name of [
  'PIXAL3D_IMAGE_TO_3D_MODEL_ID',
  'PIXAL3D_MULTIVIEW_IMAGE_TO_3D_MODEL_ID',
  'PIXAL3D_ORBIT_VIEW_SLOTS',
  'getPixal3dOrbitViewSlots',
  'isPixal3dModel',
  'isPixal3dMultiViewModel',
  'SAM3_IMAGE_SEGMENT_MODEL_ID',
  'BIREFNET_BACKGROUND_REMOVAL_MODEL_ID',
  'isModelArtifactModel',
  'isSegmentationModel',
  'requiresStartingImage',
  'isVideoModel',
  'isAudioModel'
]) {
  assert.ok(sdk[name] !== undefined, `${name} is not exported from the package root`);
}

assert.equal(sdk.PIXAL3D_IMAGE_TO_3D_MODEL_ID, 'pixal3d_int8_i23d');
assert.equal(sdk.PIXAL3D_MULTIVIEW_IMAGE_TO_3D_MODEL_ID, 'pixal3d_multiview_int8_i23d');
// Left, back and right are the worker's contextImage1/2/3 asset keys.
assert.deepEqual(sdk.PIXAL3D_ORBIT_VIEW_SLOTS, { leftViewImage: 1, backViewImage: 2, rightViewImage: 3 });
assert.deepEqual(
  sdk.getPixal3dOrbitViewSlots({ rightViewImage: true, leftViewImage: undefined }),
  [{ view: 'rightViewImage', slot: 3, media: true }]
);
for (const modelId of [sdk.PIXAL3D_IMAGE_TO_3D_MODEL_ID, sdk.PIXAL3D_MULTIVIEW_IMAGE_TO_3D_MODEL_ID]) {
  assert.equal(sdk.isPixal3dModel(modelId), true, modelId);
  assert.equal(sdk.isModelArtifactModel(modelId), true, modelId);
  assert.equal(sdk.requiresStartingImage(modelId), true, modelId);
  assert.equal(sdk.isSegmentationModel(modelId), false, modelId);
  assert.equal(sdk.isVideoModel(modelId), false, modelId);
}
assert.equal(sdk.isPixal3dMultiViewModel(sdk.PIXAL3D_MULTIVIEW_IMAGE_TO_3D_MODEL_ID), true);
assert.equal(sdk.isPixal3dMultiViewModel(sdk.PIXAL3D_IMAGE_TO_3D_MODEL_ID), false);
assert.equal(sdk.isPixal3dModel(sdk.SAM3_IMAGE_SEGMENT_MODEL_ID), false);
assert.equal(sdk.SAM3_IMAGE_SEGMENT_MODEL_ID, 'sam3_image_segment_bf16');
assert.equal(
  sdk.BIREFNET_BACKGROUND_REMOVAL_MODEL_ID,
  'birefnet_image_background_removal_fp16'
);
assert.equal(sdk.SogniTools.generateSpeech.function.name, 'generate_speech');
assert.ok(
  sdk.SogniTools.all.some((tool) => tool.function.name === 'generate_speech'),
  'generate_speech is missing from the canonical tool catalog'
);
assert.equal(sdk.SogniTools.upscaleImage.function.name, 'upscale_image');
assert.equal(sdk.SogniTools.upscaleVideo.function.name, 'upscale_video');
assert.deepEqual(
  sdk.SogniTools.upscaleVideo.function.parameters.properties.targetResolution.enum,
  [1080, 1440]
);
assert.equal(sdk.SogniTools.all.length, 30);

assert.equal(sdk.isModelArtifactModel(sdk.PIXAL3D_IMAGE_TO_3D_MODEL_ID), true);
assert.equal(sdk.isModelArtifactModel(sdk.SAM3_IMAGE_SEGMENT_MODEL_ID), false);
assert.equal(sdk.isModelArtifactModel(sdk.BIREFNET_BACKGROUND_REMOVAL_MODEL_ID), false);
assert.equal(sdk.isSegmentationModel(sdk.SAM3_IMAGE_SEGMENT_MODEL_ID), true);
assert.equal(sdk.isSegmentationModel(sdk.PIXAL3D_IMAGE_TO_3D_MODEL_ID), false);
// BiRefNet reaches the same artifact with no prompt. A consumer that hides a
// mask from a gallery, refuses to enhance one, or requires a source image has
// to see it here, or it treats a matte as an ordinary render.
assert.equal(sdk.isSegmentationModel(sdk.BIREFNET_BACKGROUND_REMOVAL_MODEL_ID), true);

// All three transform a source image, so none can run from a prompt alone.
assert.equal(sdk.requiresStartingImage(sdk.PIXAL3D_IMAGE_TO_3D_MODEL_ID), true);
assert.equal(sdk.requiresStartingImage(sdk.SAM3_IMAGE_SEGMENT_MODEL_ID), true);
assert.equal(sdk.requiresStartingImage(sdk.BIREFNET_BACKGROUND_REMOVAL_MODEL_ID), true);
assert.equal(sdk.requiresStartingImage('z_image_turbo_bf16'), false);

// Segmentation is not a generated image and must not be classified as one.
assert.equal(sdk.isVideoModel(sdk.SAM3_IMAGE_SEGMENT_MODEL_ID), false);
assert.equal(sdk.isAudioModel(sdk.SAM3_IMAGE_SEGMENT_MODEL_ID), false);
assert.equal(sdk.isVideoModel(sdk.BIREFNET_BACKGROUND_REMOVAL_MODEL_ID), false);
assert.equal(sdk.isAudioModel(sdk.BIREFNET_BACKGROUND_REMOVAL_MODEL_ID), false);

console.log('SDK capability export checks passed');

for (const name of ['imageTo3d', 'removeBackground', 'segmentImage']) assert.ok(sdk.SogniTools[name]?.function?.name);
