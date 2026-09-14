'use strict';
/**
 * MiniMax H3 FastH3 Two-Stage model ids. Runs against compiled output so it also
 * checks the published API shape.
 *
 * - the three `_turbo_2stage` ids are MiniMax H3 video ids of the 4-step FastH3
 *   class, with the workflow, frame grid and canvas defaults of their FastH3 base;
 * - their request is the FastH3 request with only the model id changed, for the
 *   720p (384 short edge), 1080p (544 short edge) and 2K (768p) canvases alike;
 * - a caller that still passes the retired `outputScale` (any value, on any video
 *   model) is refused with the socket's wording before any request is made, both
 *   by projects.create and by the request builder; no request carries the key.
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
const ProjectsApi = require('../dist/Projects/index.js').default;

const retiredOutputScale =
  /^outputScale is no longer supported\. For MiniMax H3 1080p or 2K output use the two-stage model ids minimax-h3-fastvideo-int8_t2v_turbo_2stage, minimax-h3-fastvideo-int8_i2v_turbo_2stage or minimax-h3-fastvideo-int8_flf2v_turbo_2stage\.$/;
const isRetiredOutputScale = (error) =>
  error.status === 400 && retiredOutputScale.test(error.message);

const twoStage = {
  t2v: ['minimax-h3-fastvideo-int8_t2v_turbo_2stage', 'minimax-h3-fastvideo-int8_t2v_turbo'],
  i2v: ['minimax-h3-fastvideo-int8_i2v_turbo_2stage', 'minimax-h3-fastvideo-int8_i2v_turbo'],
  flf2v: ['minimax-h3-fastvideo-int8_flf2v_turbo_2stage', 'minimax-h3-fastvideo-int8_flf2v_turbo']
};
// The socket records 384 px two-stage renders under these ids; the SDK knows them
// as FastH3-class H3 video ids so their projects and results are handled.
const twoStage720p = {
  t2v: ['minimax-h3-fastvideo-int8_t2v_turbo_2stage_720p', 'minimax-h3-fastvideo-int8_t2v_turbo'],
  i2v: ['minimax-h3-fastvideo-int8_i2v_turbo_2stage_720p', 'minimax-h3-fastvideo-int8_i2v_turbo'],
  flf2v: ['minimax-h3-fastvideo-int8_flf2v_turbo_2stage_720p', 'minimax-h3-fastvideo-int8_flf2v_turbo']
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
    ...Object.values(twoStage).flat(),
    ...Object.values(twoStage720p).map(([modelId]) => modelId)
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

for (const [workflow, [modelId, baseId]] of Object.entries(twoStage720p)) {
  assert.equal(isVideoModel(modelId), true, `${modelId} is a video model`);
  assert.equal(isMinimaxH3Model(modelId), true, `${modelId} is a MiniMax H3 id`);
  assert.equal(isMinimaxH3TurboModel(modelId), true, `${modelId} is 4-step FastH3 class`);
  assert.equal(getVideoWorkflowType(modelId), workflow);
  assert.equal(calculateVideoFrames(modelId, 6, 24), calculateVideoFrames(baseId, 6, 24));
  const sent = request(modelId, 'turbo', { width: 672, height: 384 }).keyFrames[0];
  assert.deepEqual({ ...sent, modelID: baseId }, request(baseId, 'turbo', { width: 672, height: 384 }).keyFrames[0]);
}

let covered = 0;
for (const [tier, ids] of Object.entries(h3Ids)) {
  for (const modelId of ids) {
    assert.equal(isMinimaxH3Model(modelId), true, `${modelId} is a MiniMax H3 id`);
    assert.equal(JSON.stringify(request(modelId, tier)).includes('outputScale'), false);
    for (const outputScale of [2, 1, 0, null, '2', false]) {
      assert.throws(
        () => request(modelId, tier, { outputScale }),
        isRetiredOutputScale,
        `${modelId}: outputScale ${String(outputScale)} is refused`
      );
    }
    covered += 1;
  }
}
assert.equal(covered, 21, 'every MiniMax H3 workflow id is covered');

// The retired field is refused on every video model, not only on MiniMax H3.
for (const modelId of ['ltx25-22b-int8_t2v_distilled', 'wan_v2.2-14b-fp8_t2v_lightx2v']) {
  const base = {
    type: 'video',
    modelId,
    positivePrompt: 'a kite',
    numberOfMedia: 1,
    duration: 5,
    width: 1280,
    height: 720
  };
  assert.throws(
    () => create(`retired-${modelId}`, { ...base, outputScale: 1 }, options),
    isRetiredOutputScale
  );
}

(async () => {
  // projects.create refuses before it fetches model options or uploads anything.
  const networkCalls = [];
  const client = {
    socket: {
      get: async (path) => networkCalls.push(path),
      send: async (type) => networkCalls.push(type)
    },
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    on() {},
    off() {}
  };
  const projects = Object.create(ProjectsApi.prototype);
  projects.client = client;
  projects.getModelOptions = async (modelId) => {
    networkCalls.push(`model-options:${modelId}`);
    return options;
  };
  await assert.rejects(
    projects.create(paramsFor(twoStage.t2v[1], 'turbo', { outputScale: 2 })),
    isRetiredOutputScale
  );
  assert.deepEqual(networkCalls, [], 'no request is made for a retired outputScale');

  console.log('MiniMax H3 two-stage model id checks passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
