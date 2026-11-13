'use strict';

// Seedream 5.5 Uncensored (`seedream-5-5-uncensored`): an additive model with
// Seedream 5.0 Pro Uncensored's contract. It must be recognised as Seedream
// everywhere (references, sizes, no sampling fields, chosen only by name), and
// every 5.0 Pro selector must keep naming 5.0 Pro.

const assert = require('node:assert/strict');
const sdk = require('../dist/index.js');
const { PREFERRED_MODEL_IDS, isEditImageModel, resolveHostedToolModelSelector } = require('../dist/Chat/modelRouting.js');
const createJobRequestMessage = require('../dist/Projects/createJobRequestMessage.js').default;
const {
  getMaxContextImages,
  isComfyModel,
  isGptImageModel,
  isSeedreamModel,
  validateCustomImageSize,
  validateSeedreamOptions
} = require('../dist/lib/validation.js');

const SEEDREAM_55 = 'seedream-5-5-uncensored';
const SEEDREAM_PRO = 'seedream-5-0-pro-uncensored';

assert.equal(sdk.SEEDREAM_5_5_UNCENSORED_MODEL_ID, SEEDREAM_55);
assert.equal(sdk.SEEDREAM_5_PRO_UNCENSORED_MODEL_ID, SEEDREAM_PRO);
assert.equal(PREFERRED_MODEL_IDS.image.seedream55Uncensored, SEEDREAM_55);
assert.equal(PREFERRED_MODEL_IDS.image.seedream5ProUncensored, SEEDREAM_PRO);
assert.equal(isSeedreamModel(SEEDREAM_55), true);
assert.equal(isSeedreamModel(SEEDREAM_PRO), true);
for (const other of ['seedream-5-5', 'seedream-5-5-uncensored-v2', 'seedream', undefined]) {
  assert.equal(isSeedreamModel(other), false, `${other} is not a Seedream model`);
}
assert.equal(isGptImageModel(SEEDREAM_55), false);
assert.equal(isComfyModel(SEEDREAM_55), false);
assert.equal(isEditImageModel(SEEDREAM_55), true);
assert.equal(getMaxContextImages(SEEDREAM_55), 10);
assert.equal(validateCustomImageSize(8192, { modelId: SEEDREAM_55 }), 8192);

for (const tool of ['generate_image', 'edit_image']) {
  for (const selector of [SEEDREAM_55, 'Seedream 5.5 Uncensored', 'Seedream 5.5 Spicy', 'seedream-5-5-spicy']) {
    assert.equal(resolveHostedToolModelSelector(tool, { model: selector }), SEEDREAM_55, selector);
  }
  // 5.0 Pro's selectors are unchanged, including the unversioned one.
  for (const selector of [SEEDREAM_PRO, 'Seedream 5.0 Pro Uncensored', 'seedream_uncensored', 'Seedream 5 Pro Spicy']) {
    assert.equal(resolveHostedToolModelSelector(tool, { model: selector }), SEEDREAM_PRO, selector);
  }
}

const options = {
  type: 'image',
  steps: { min: 1, max: 1, step: 1, default: 1 },
  guidance: { min: 0, max: 1, step: 0.1, default: 0 },
  sampler: { allowed: [], default: null },
  scheduler: { allowed: [], default: null }
};
const request = (params) =>
  createJobRequestMessage(
    'seedream-55-wire',
    { type: 'image', modelId: SEEDREAM_55, positivePrompt: 'A white cat in a bar', numberOfMedia: 1, ...params },
    options
  );
// The vendor's own example size, beyond the generic 2048-px edge cap.
const keyFrame = request({ sizePreset: 'custom', width: 2512, height: 1664, negativePrompt: 'blurry' }).keyFrames[0];
assert.equal(keyFrame.width, 2512);
assert.equal(keyFrame.height, 1664);
assert.equal(keyFrame.negativePrompt, undefined);
assert.throws(() => request({ sizePreset: 'custom', width: 1024, height: 768 }), /renders 921,600 to 4,194,304 pixels/);
validateSeedreamOptions({ type: 'image', modelId: SEEDREAM_55, contextImages: Array(10).fill('r') });
assert.throws(
  () => validateSeedreamOptions({ type: 'image', modelId: SEEDREAM_55, contextImages: Array(11).fill('r') }),
  /accepts up to 10 non-empty reference images/
);

console.log('Seedream 5.5 Uncensored identity, selectors, sizes and references passed');
