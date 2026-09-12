'use strict';
/**
 * MiniMax H3 2K delivery (`outputScale`). Runs against compiled output so it also
 * checks the published API shape.
 *
 * - 2 is forwarded as keyFrame.outputScale on every MiniMax H3 id;
 * - omitted or 1 sends nothing, so existing requests stay byte-identical;
 * - other values, and 2 on any non-H3 model, are refused up front.
 */
const assert = require('node:assert/strict');
const create = require('../dist/Projects/createJobRequestMessage.js').default;

const options = {
  type: 'video',
  sampler: { allowed: [], default: null },
  scheduler: { allowed: [], default: null }
};
const h3Ids = {
  standard: ['minimax-h3-fl2va-fp8_t2v', 'minimax-h3-fl2va-fp8_i2v', 'minimax-h3-fl2va-fp8_flf2v', 'minimax-h3-ref2va-fp8_r2v'],
  balanced: [
    'minimax-h3-fl2va-fp8_t2v_balanced',
    'minimax-h3-fl2va-fp8_i2v_balanced',
    'minimax-h3-fl2va-fp8_flf2v_balanced',
    'minimax-h3-ref2va-fp8_r2v_balanced'
  ],
  turbo: [
    'minimax-h3-fl2va-fp8_t2v_turbo',
    'minimax-h3-fl2va-fp8_i2v_turbo',
    'minimax-h3-fl2va-fp8_flf2v_turbo',
    'minimax-h3-ref2va-fp8_r2v_turbo',
    'minimax-h3-fastvideo-int8_t2v_turbo',
    'minimax-h3-fastvideo-int8_i2v_turbo',
    'minimax-h3-fastvideo-int8_flf2v_turbo'
  ]
};
const steps = { standard: 20, balanced: 8, turbo: 4 };
const image = new Blob(['image'], { type: 'image/png' });

function paramsFor(modelId, tier, changes = {}) {
  const params = {
    type: 'video',
    modelId,
    positivePrompt: 'integrated_multimodal_description: [Shot 1] A kite over a beach.',
    numberOfMedia: 1,
    duration: 6,
    width: 1344,
    height: 768,
    steps: steps[tier],
    guidance: 1,
    ...changes
  };
  if (/_i2v|_flf2v/.test(modelId)) params.referenceImage = image;
  if (/_flf2v/.test(modelId)) params.referenceImageEnd = image;
  if (/_r2v/.test(modelId)) params.referenceImage = image;
  return params;
}
const request = (modelId, tier, changes) =>
  create(`h3-2k-${modelId}`, paramsFor(modelId, tier, changes), options).keyFrames[0];

let covered = 0;
for (const [tier, ids] of Object.entries(h3Ids)) {
  for (const modelId of ids) {
    const plain = request(modelId, tier);
    assert.equal('outputScale' in plain, false, `${modelId}: omitted outputScale must send nothing`);
    const one = request(modelId, tier, { outputScale: 1 });
    assert.equal('outputScale' in one, false, `${modelId}: outputScale 1 must send nothing`);
    assert.deepEqual(one, plain, `${modelId}: outputScale 1 must be byte-identical to omitting it`);
    const two = request(modelId, tier, { outputScale: 2 });
    assert.equal(two.outputScale, 2, `${modelId}: outputScale 2 must reach the key frame`);
    // 2K is a delivery switch: the requested canvas, frames and fps are unchanged.
    assert.equal(two.width, 1344);
    assert.equal(two.height, 768);
    assert.equal(two.frames, plain.frames);
    assert.equal(two.fps, 24);
    for (const outputScale of [0, 3, 4, -2, 1.5, '2', true, null, NaN]) {
      assert.throws(
        () => request(modelId, tier, { outputScale }),
        /MiniMax H3 outputScale must be 1 or 2/,
        `${modelId}: outputScale ${String(outputScale)} must be refused`
      );
    }
    covered += 1;
  }
}
assert.equal(covered, 15, 'every MiniMax H3 workflow id is covered');

// Other video models have no 2K stage: 2 is refused, 1 is harmless and sends nothing.
for (const modelId of ['ltx25-22b-int8_t2v_distilled', 'wan_v2.2-14b-fp8_t2v_lightx2v', 'seedance-2-0']) {
  const base = { type: 'video', modelId, positivePrompt: 'a kite', numberOfMedia: 1, duration: 5, width: 1280, height: 720 };
  assert.throws(
    () => create(`non-h3-${modelId}`, { ...base, outputScale: 2 }, options),
    /outputScale is supported only by MiniMax H3 models/
  );
  const one = create(`non-h3-one-${modelId}`, { ...base, outputScale: 1 }, options).keyFrames[0];
  assert.equal('outputScale' in one, false);
}

console.log('MiniMax H3 outputScale request checks passed');
