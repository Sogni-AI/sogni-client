'use strict';
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const createRequest = require('../dist/Projects/createJobRequestMessage.js').default;
const ProjectsApi = require('../dist/Projects/index.js').default;
const { projectParamsFromRecoveredProject } = require('../dist/Projects/recovery.js');
const options = {
  type: 'image',
  steps: { min: 1, max: 50, step: 1, default: 10 },
  guidance: { min: 0, max: 20, step: 0.1, default: 1 },
  sampler: { allowed: [], default: null },
  scheduler: { allowed: [], default: null }
};
const base = {
  type: 'image',
  modelId: 'flux',
  positivePrompt: 'A garden',
  numberOfMedia: 1,
  steps: 10,
  guidance: 1,
  sizePreset: 'custom',
  width: 1024,
  height: 1024
};
for (const priorityMode of [true, false, undefined]) {
  const wire = createRequest('priority-project', { ...base, priorityMode }, options);
  assert.equal(wire.priorityMode, priorityMode);
  if (priorityMode === undefined) assert.equal(Object.hasOwn(wire, 'priorityMode'), false);
  const recovered = projectParamsFromRecoveredProject({
    model: { id: 'flux', type: 'image' },
    ...(priorityMode === undefined ? {} : { priorityMode })
  });
  assert.equal(recovered.priorityMode, priorityMode);
}
assert.throws(
  () => createRequest('invalid', { ...base, priorityMode: 'true' }, options),
  /must be true or false/
);

async function main() {
  const paths = [];
  const client = new EventEmitter();
  client.socket = Object.assign(new EventEmitter(), {
    get: async (path) => {
      paths.push(path);
      return {
        quote: { project: {} },
        dailyFairUse: { pct: 3 },
        ...(path.includes('includeMonthlyFairUse=true') ? { monthlyFairUse: { pct: 0.15 } } : {})
      };
    }
  });
  client.logger = { info() {}, warn() {}, error() {}, debug() {} };
  const projects = new ProjectsApi({ client, eip712: {} });
  projects.getModelOptions = async () => options;
  const estimates = [
    (includeMonthlyFairUse) =>
      projects.estimateCost({
        model: 'flux',
        imageCount: 1,
        stepCount: 10,
        previewCount: 0,
        priorityMode: true,
        includeMonthlyFairUse
      }),
    (includeMonthlyFairUse) =>
      projects.estimateVideoCost({
        model: 'minimax-h3-ref2va-fp8_r2v',
        tokenType: 'spark',
        width: 1344,
        height: 768,
        duration: 6,
        fps: 24,
        steps: 20,
        numberOfMedia: 1,
        priorityMode: true,
        includeMonthlyFairUse
      }),
    (includeMonthlyFairUse) =>
      projects.estimateAudioCost({
        model: 'minimax_music3',
        tokenType: 'spark',
        duration: 30,
        steps: 30,
        numberOfMedia: 1,
        priorityMode: true,
        includeMonthlyFairUse
      })
  ];
  for (const estimate of estimates) {
    const ordinary = await estimate();
    assert.equal(ordinary.dailyFairUsePct, 3);
    assert.equal(Object.hasOwn(ordinary, 'monthlyFairUsePct'), false);
    assert.equal(
      new URL('https://socket.test' + paths.at(-1)).searchParams.has('includeMonthlyFairUse'),
      false
    );
    const expanded = await estimate(true);
    assert.equal(expanded.monthlyFairUsePct, 0.15);
    assert.equal(
      new URL('https://socket.test' + paths.at(-1)).searchParams.get('includeMonthlyFairUse'),
      'true'
    );
    assert.equal(
      new URL(`https://socket.test${paths.at(-1)}`).searchParams.get('priorityMode'),
      'true'
    );
  }
  console.log('Priority mode generation, recovery and image/video/audio quote checks passed');
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
