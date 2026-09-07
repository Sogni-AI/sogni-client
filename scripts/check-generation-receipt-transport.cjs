'use strict';

const assert = require('node:assert/strict');
const createJobRequestMessage = require('../dist/Projects/createJobRequestMessage.js').default;

const options = {
  type: 'image',
  steps: { min: 1, max: 50, step: 1, default: 10 },
  guidance: { min: 0, max: 20, step: 0.1, default: 1 },
  sampler: { allowed: [], default: null },
  scheduler: { allowed: [], default: null }
};
const source = 'A'.repeat(64);
const selection = 'B'.repeat(64);
const base = {
  type: 'image', modelId: 'model-from-service-plan', appSource: 'receipt-transport-test',
  positivePrompt: 'A garden', numberOfMedia: 1, steps: 10, guidance: 1,
  sizePreset: 'custom', width: 1024, height: 1024
};
const receipt = { stage: 'target_still', sourceImageSha256: source, selectionHash: selection };
const request = params => createJobRequestMessage('receipt-transport', params, options);

// The serializer has no application allowlist or hard-coded recipe model.
for (const appSource of [undefined, 'receipt-transport-test']) {
  assert.deepEqual(request({ ...base, appSource, worldGenerationReceipt: receipt }).keyFrames[0].worldGenerationReceipt, {
    stage: 'target_still', sourceImageSha256: source.toLowerCase(), selectionHash: selection.toLowerCase()
  });
}
assert.deepEqual(request({ ...base, worldGenerationReceipt: {
  stage: 'transition', firstFrameSha256: source, lastFrameSha256: selection
} }).keyFrames[0].worldGenerationReceipt, {
  stage: 'transition', firstFrameSha256: source.toLowerCase(), lastFrameSha256: selection.toLowerCase()
});
assert.equal(request(base).keyFrames[0].worldGenerationReceipt, undefined);
assert.throws(() => request({ ...base, worldGenerationReceipt: { ...receipt, sourceImageSha256: 'invalid' } }), /SHA-256/);
assert.throws(() => request({ ...base, worldGenerationReceipt: { stage: 'unknown' } }), /stage/);
assert.deepEqual(receipt, { stage: 'target_still', sourceImageSha256: source, selectionHash: selection });
console.log('Generation receipt transport checks passed');
