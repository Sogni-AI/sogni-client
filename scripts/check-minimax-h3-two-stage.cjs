'use strict';
/**
 * MiniMax H3 FastH3 Two-Stage model ids. Runs against compiled output so it also
 * checks the published API shape.
 *
 * - the three `_turbo_2stage` ids are MiniMax H3 video ids of the 4-step FastH3
 *   class, with the workflow, frame grid and canvas defaults of their FastH3 base;
 * - their request is the FastH3 request with only the model id changed, for the
 *   720p (384 short edge), 1080p (544 short edge) and 2K (768p) canvases alike;
 * - no request built by the SDK carries `outputScale`, on any MiniMax H3 id, even
 *   when an untyped caller still passes it: the socket refuses the key outright.
 */
const assert = require('node:assert/strict');
const create = require('../dist/Projects/createJobRequestMessage.js').default;
const {
  calculateVideoFrames,
  getVideoWorkflowType,
  isMinimaxH3BalancedModel,
  isMinimaxH3Model,
  isMinimaxH3ReferenceModel,
  isMinimaxH3TurboModel,
  isVideoModel
} = require('../dist/Projects/utils/index.js');
const { getVideoDefaults } = require('../dist/Chat/modelRouting.js');

const twoStage = {
  t2v: ['minimax-h3-fastvideo-int8_t2v_turbo_2stage', 'minimax-h3-fastvideo-int8_t2v_turbo'],
  i2v: ['minimax-h3-fastvideo-int8_i2v_turbo_2stage', 'minimax-h3-fastvideo-int8_i2v_turbo'],
  flf2v: ['minimax-h3-fastvideo-int8_flf2v_turbo_2stage', 'minimax-h3-fastvideo-int8_flf2v_turbo']
};
const h3Ids = {
  standard: [
    'minimax-h3-fl2va-fp8_t2v',
    'minimax-h3-fl2va-fp8_i2v',
    'minimax-h3-fl2va-fp8_flf2v',
    'minimax-h3-ref2va-fp8_r2v'
  ],
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
    ...Object.values(twoStage).flat()
  ]
};
const steps = { standard: 20, balanced: 8, turbo: 4 };
const options = {
  type: 'video',
  sampler: { allowed: [], default: null },
  scheduler: { allowed: [], default: null }
};

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
  if (/_i2v|_flf2v|_r2v/.test(modelId)) params.referenceImage = true;
  if (/_flf2v/.test(modelId)) params.referenceImageEnd = true;
  return params;
}
const request = (modelId, tier, changes) =>
  create(`h3-${modelId}`, paramsFor(modelId, tier, changes), options);

for (const [workflow, [modelId, baseId]] of Object.entries(twoStage)) {
  assert.equal(isVideoModel(modelId), true, `${modelId} is a video model`);
  assert.equal(isMinimaxH3Model(modelId), true, `${modelId} is a MiniMax H3 id`);
  assert.equal(isMinimaxH3TurboModel(modelId), true, `${modelId} is 4-step FastH3 class`);
  assert.equal(isMinimaxH3BalancedModel(modelId), false);
  assert.equal(isMinimaxH3ReferenceModel(modelId), false);
  assert.equal(getVideoWorkflowType(modelId), workflow);
  assert.deepEqual(getVideoDefaults(modelId), getVideoDefaults(baseId));
  assert.deepEqual(getVideoDefaults(modelId), { width: 1344, height: 768, fps: 24 });
  for (const duration of [1, 5, 6, 10, 15.08, 30]) {
    assert.equal(
      calculateVideoFrames(modelId, duration, 24),
      calculateVideoFrames(baseId, duration, 24),
      `${modelId}: ${duration}s uses the FastH3 frame grid`
    );
  }

  // 2K sends the 768p canvas; 1080p and 720p send the chosen aspect at a 544 px
  // or 384 px short edge. The clip is delivered at twice the canvas.
  for (const [width, height] of [
    [1344, 768],
    [768, 1344],
    [960, 544],
    [544, 960],
    [672, 384],
    [384, 672],
    [384, 384]
  ]) {
    const sent = request(modelId, 'turbo', { width, height }).keyFrames[0];
    const base = request(baseId, 'turbo', { width, height }).keyFrames[0];
    assert.equal(sent.modelID, modelId);
    assert.deepEqual(
      { ...sent, modelID: baseId },
      base,
      `${modelId} ${width}x${height}: the request is the FastH3 request with only the id changed`
    );
    assert.equal(sent.width, width);
    assert.equal(sent.height, height);
    assert.equal(sent.steps, 4);
    assert.equal(sent.frames, 141);
  }
  assert.throws(
    () => request(modelId, 'standard'),
    /MiniMax H3 Turbo steps are fixed at 4/,
    `${modelId}: steps other than 4 are refused`
  );
  assert.throws(
    () => request(modelId, 'turbo', { width: 1920, height: 1088 }),
    /MiniMax H3 dimensions must use a 32px grid/,
    `${modelId}: the delivered size is not a canvas`
  );
}

let covered = 0;
for (const [tier, ids] of Object.entries(h3Ids)) {
  for (const modelId of ids) {
    assert.equal(isMinimaxH3Model(modelId), true, `${modelId} is a MiniMax H3 id`);
    for (const changes of [{}, { outputScale: 2 }, { outputScale: 1 }]) {
      const message = request(modelId, tier, changes);
      assert.equal(
        JSON.stringify(message).includes('outputScale'),
        false,
        `${modelId}: the request never carries outputScale`
      );
    }
    covered += 1;
  }
}
assert.equal(covered, 18, 'every MiniMax H3 workflow id is covered');

console.log('MiniMax H3 two-stage model id checks passed');
