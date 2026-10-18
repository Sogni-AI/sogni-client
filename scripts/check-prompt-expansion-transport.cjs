'use strict';
const assert = require('node:assert/strict');
const createRequest = require('../dist/Projects/createJobRequestMessage.js').default;
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
for (const promptExpanded of [true, false, undefined]) {
  const params = { ...base, ...(promptExpanded === undefined ? {} : { promptExpanded }) };
  const wire = createRequest('expanded-project', params, options);
  assert.equal(wire.promptExpanded, promptExpanded);
  assert.equal(wire.keyFrames[0].promptExpanded, undefined);
  assert.equal(wire.keyFrames[0].positivePrompt, base.positivePrompt);
  const recovered = projectParamsFromRecoveredProject({
    model: { id: 'flux', type: 'image' },
    ...(promptExpanded === undefined ? {} : { promptExpanded })
  });
  assert.equal(recovered.promptExpanded, promptExpanded);
  if (promptExpanded === undefined) {
    assert.equal(Object.hasOwn(wire, 'promptExpanded'), false);
    assert.equal(Object.hasOwn(recovered, 'promptExpanded'), false);
  }
}
console.log('promptExpanded transport and recovery checks passed');
