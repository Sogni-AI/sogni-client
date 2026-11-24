'use strict';
const assert = require('node:assert/strict');
const create = require('../dist/Projects/createJobRequestMessage.js').default;
const ids = [
  'minimax-h3-ref2va-fp8_r2v',
  'minimax-h3-ref2va-fp8_r2v_balanced',
  'minimax-h3-ref2va-fp8_r2v_turbo',
  'minimax-h3-fastvideo-omni-int8_r2v_turbo'
];
const options = {
  type: 'video',
  steps: { min: 1, max: 50, step: 1, default: 8 },
  guidance: { min: 1, max: 10, step: 1, default: 1 },
  fps: { allowed: [24], default: 24 },
  sampler: { allowed: [], default: null },
  scheduler: { allowed: ['simple'], default: 'simple' }
};
const build = (extra = {}) =>
  create(
    'vpack-contract',
    {
      type: 'video',
      modelId: ids[1],
      numberOfMedia: 1,
      positivePrompt: 'A character walks.',
      frames: 124,
      width: 1344,
      height: 768,
      steps: extra.modelId === ids[0] ? 20 : extra.modelId === ids[2] ? 4 : 8,
      guidance: 1,
      scheduler: 'simple',
      referenceVideo: Buffer.from('video'),
      ...extra
    },
    options
  ).keyFrames[0];
for (const modelId of ids) {
  const plain = build({ modelId });
  assert.deepEqual(build({ modelId, referenceVideoCompression: 'none' }), plain);
  const packed = build({ modelId, referenceVideoCompression: 'vpack' });
  assert.equal(packed.referenceVideoCompression, 'vpack');
  delete packed.referenceVideoCompression;
  assert.deepEqual(packed, plain);
}
assert.throws(() => build({ referenceVideoCompression: 'automatic' }), /referenceVideoCompression/);
assert.throws(
  () =>
    build({
      referenceVideo: undefined,
      referenceImage: Buffer.from('image'),
      referenceVideoCompression: 'vpack'
    }),
  /reference video/
);
assert.throws(
  () => build({ modelId: ids[1] + '_2stage', referenceVideoCompression: 'vpack' }),
  /one-stage/
);
assert.throws(
  () => build({ modelId: 'minimax-h3-fl2va-fp8_t2v', referenceVideoCompression: 'vpack' }),
  /MiniMax/
);
console.log('MiniMax VPack compiled SDK contract passed');
