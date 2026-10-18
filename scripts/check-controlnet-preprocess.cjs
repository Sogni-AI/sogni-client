const assert = require('node:assert/strict');
const request = require('../dist/Projects/createJobRequestMessage.js').default;

const options = {
  type: 'image',
  steps: { min: 1, max: 60, default: 20 },
  guidance: { min: 0, max: 30, default: 7 },
  sampler: { allowed: [], default: null },
  scheduler: { allowed: [], default: null }
};
const params = {
  type: 'image',
  modelId: 'coreml-cyberrealistic_v70_768',
  positivePrompt: 'A lighthouse on a cliff',
  numberOfMedia: 1,
  seed: 7
};
const controlNet = {
  name: 'depth',
  image: true,
  strength: 0.8,
  mode: 'cn_priority',
  guidanceStart: 0,
  guidanceEnd: 1
};

function controlNetsOf(wire) {
  return wire.keyFrames[0].currentControlNetsJob;
}

// Omitted: the entry is exactly today's shape, with no preprocess key.
const baseline = request('cn-baseline', { ...params, controlNet }, options);
assert.deepEqual(controlNetsOf(baseline), [
  {
    name: 'depth',
    cnImageState: 'original',
    hasImage: true,
    controlStrength: 0.8,
    controlMode: 2,
    controlGuidanceStart: 0,
    controlGuidanceEnd: 1
  }
]);
assert.equal(Object.hasOwn(controlNetsOf(baseline)[0], 'preprocess'), false);

// false behaves exactly like omitted: the whole request is byte-identical.
const explicitOff = request(
  'cn-baseline',
  { ...params, controlNet: { ...controlNet, preprocess: false } },
  options
);
assert.equal(JSON.stringify(explicitOff), JSON.stringify(baseline));

// true adds preprocess: true to the entry and changes nothing else.
const on = request(
  'cn-baseline',
  { ...params, controlNet: { ...controlNet, preprocess: true } },
  options
);
const onEntry = controlNetsOf(on)[0];
assert.equal(onEntry.preprocess, true);
assert.equal(onEntry.cnImageState, 'original');
const { preprocess, ...onWithoutFlag } = onEntry;
assert.deepEqual(onWithoutFlag, controlNetsOf(baseline)[0]);
assert.equal(
  JSON.stringify({ ...on, keyFrames: [{ ...on.keyFrames[0], currentControlNetsJob: [onWithoutFlag] }] }),
  JSON.stringify(baseline)
);

// Minimal call: only name + image + preprocess.
const minimal = request(
  'cn-minimal',
  { ...params, controlNet: { name: 'openpose', image: true, preprocess: true } },
  options
);
assert.deepEqual(controlNetsOf(minimal), [
  { name: 'openpose', cnImageState: 'original', hasImage: true, preprocess: true }
]);

// Anything other than a boolean is rejected.
for (const value of ['true', 1, null]) {
  assert.throws(
    () =>
      request('cn-invalid', { ...params, controlNet: { ...controlNet, preprocess: value } }, options),
    /controlNet\.preprocess must be a boolean/
  );
}

console.log('ControlNet preprocess checks passed');
