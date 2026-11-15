'use strict';
/**
 * MiniMax H3 Prism (`minimax-h3-prism-int8_r2v`): an optional reference-to-video
 * model for mature themes, with its recipe fixed on the worker. Runs against
 * compiled output.
 *
 * - it is a MiniMax H3 video id on the r2v workflow, with the same reference
 *   rules, keyframes and frame grid as Balanced R2V, including its two-stage id;
 * - its steps are fixed at 8, and it is neither a Balanced nor a Turbo id;
 * - the H3 example lists it under its own key and, like LTX-2.3 10Eros, refuses
 *   to run it without --disable-safe-content-filter and a prompt of the
 *   creator's own.
 */
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const createJobRequestMessage = require('../dist/Projects/createJobRequestMessage.js').default;
const sdk = require('../dist/index.js');
const {
  calculateVideoFrames,
  getVideoAssetRequirements,
  getVideoWorkflowType,
  isMinimaxH3BalancedModel,
  isMinimaxH3KeyframeModel,
  isMinimaxH3Model,
  isMinimaxH3PrismModel,
  isMinimaxH3ReferenceModel,
  isMinimaxH3TurboModel,
  isVideoModel
} = require('../dist/Projects/utils/index.js');

const repoRoot = path.resolve(__dirname, '..');
const PRISM = 'minimax-h3-prism-int8_r2v';
const BALANCED_R2V = 'minimax-h3-ref2va-fp8_r2v_balanced';

// --- Classification ------------------------------------------------------------------------
assert.equal(isVideoModel(PRISM), true);
assert.equal(sdk.isVideoModel(PRISM), true);
assert.equal(isMinimaxH3Model(PRISM), true);
assert.equal(getVideoWorkflowType(PRISM), 'r2v');
assert.equal(isMinimaxH3ReferenceModel(PRISM), true);
assert.equal(isMinimaxH3KeyframeModel(PRISM), true, 'Prism keeps intermediate keyframes');
assert.equal(sdk.isMinimaxH3KeyframeModel(PRISM), true);
assert.equal(isMinimaxH3PrismModel(PRISM), true);
assert.equal(isMinimaxH3BalancedModel(PRISM), false, 'Prism carries no Larry v4 adapter');
assert.equal(isMinimaxH3TurboModel(PRISM), false);
assert.equal(sdk.isMinimaxH3AudioGuideModel(PRISM), false);
for (const other of [
  BALANCED_R2V,
  'minimax-h3-ref2va-fp8_r2v',
  'minimax-h3-prism-int8_r2v_2stage_unknown'
]) {
  assert.equal(isMinimaxH3PrismModel(other), false, other);
}
assert.equal(isMinimaxH3Model('minimax-h3-prism-int8_r2v_2stage'), true);
assert.equal(isMinimaxH3PrismModel('minimax-h3-prism-int8_r2v_2stage'), true);
assert.deepEqual(getVideoAssetRequirements(PRISM), getVideoAssetRequirements(BALANCED_R2V));
assert.equal(calculateVideoFrames(PRISM, 6, 24), calculateVideoFrames(BALANCED_R2V, 6, 24));
assert.equal(calculateVideoFrames(PRISM, 15, 24), 362);

// --- Request validation --------------------------------------------------------------------
const options = {
  type: 'video',
  steps: { min: 8, max: 8, step: 1, default: 8 },
  guidance: { min: 1, max: 1, step: 1, default: 1 },
  fps: { allowed: [24], default: 24 },
  sampler: { allowed: ['euler'], default: 'euler' },
  scheduler: { allowed: [], default: null }
};
const base = {
  type: 'video',
  modelId: PRISM,
  positivePrompt: 'subject_definitions:\n<Subject 1> is the dancer in <Picture 1>.',
  numberOfMedia: 1,
  frames: 141,
  width: 1344,
  height: 768,
  steps: 8,
  guidance: 1,
  sampler: 'euler',
  referenceImage: true,
  disableNSFWFilter: true
};
const request = (changes = {}) =>
  createJobRequestMessage('h3-prism', { ...base, ...changes }, options).keyFrames[0];

const plain = request();
const enlarged = request({ modelId: 'minimax-h3-prism-int8_r2v_2stage' });
assert.deepEqual(
  enlarged,
  { ...plain, modelID: 'minimax-h3-prism-int8_r2v_2stage' },
  'the optional two-stage id sends the same fixed recipe and canvas'
);
assert.throws(
  () => request({ modelId: 'minimax-h3-prism-int8_r2v_2stage', steps: 4 }),
  /steps are fixed at 8/
);
assert.equal(plain.frames, 141);
assert.equal(plain.steps, 8);
assert.equal(plain.hasReferenceImage, true);
assert.equal(plain.comfyScheduler, null, 'no scheduler is sent: the worker fixes the schedule');
assert.equal(request({ steps: undefined }).frames, 141, 'steps may be omitted');
for (const steps of [4, 20]) {
  assert.throws(() => request({ steps }), { message: 'MiniMax H3 Prism steps are fixed at 8.' });
}
assert.throws(() => request({ guidance: 3 }), { message: 'MiniMax H3 guidance is fixed at 1.' });
assert.throws(() => request({ frames: 130 }), /124 \+ n\*17/);

// Up to 9 reference images (referenceImage plus 8 context images), as on Balanced R2V.
const references = request({ contextImages: Array.from({ length: 8 }, () => true) });
assert.equal(references.hasReferenceImage, true);
assert.equal(Object.keys(references).filter((key) => key.startsWith('hasContextImage')).length, 8);
assert.throws(() => request({ contextImages: Array.from({ length: 9 }, () => true) }));

// Intermediate keyframes ride in their own slots.
const pinned = request({ keyframes: [{ image: true, frameIndex: 72 }] });
assert.equal(pinned.hasKeyframeImage1, true);
assert.deepEqual(pinned.keyframeFrameIndices, [72]);

// Catalog LoRAs are passed through as on the other r2v ids.
const withLora = request({ loras: ['h3-realism-people-t2v-i2v-r2v'], loraStrengths: [0.8] });
assert.deepEqual(withLora.loras, ['h3-realism-people-t2v-i2v-r2v']);
assert.deepEqual(withLora.loraStrengths, [0.8]);

// --- Example catalog and script ------------------------------------------------------------
(async () => {
  const helpers = await import(
    `${pathToFileURL(path.join(repoRoot, 'examples', 'workflow-helpers.mjs')).href}?prism-test=${Date.now()}`
  );
  const config = helpers.MODELS.h3['minimax-h3-r2v-prism'];
  assert.ok(config, 'the H3 example catalog lists Prism');
  assert.equal(config.id, PRISM);
  assert.equal(config.workflowType, 'r2v');
  assert.equal(config.defaultSteps, 8);
  assert.equal(config.minSteps, 8);
  assert.equal(config.maxSteps, 8);
  assert.deepEqual(config.allowedComfySamplers, ['euler']);
  assert.deepEqual(config.allowedComfySchedulers, []);
  assert.equal(config.defaultComfyScheduler, undefined);
  assert.equal(config.defaultWidth, 1344);
  assert.equal(config.defaultHeight, 768);
  assert.equal(config.requiresDisabledSafetyFilter, true);
  assert.equal(config.requiresVisualReference, true);
  assert.equal(config.maxReferenceImages, 9);
  assert.equal(
    Object.values(helpers.MODELS.h3).filter((model) => model.id.startsWith('minimax-h3-prism'))
      .length,
    1,
    'Prism has one example key: no two-stage key'
  );

  const script = path.join(repoRoot, 'examples', 'workflow_minimax_h3_video.mjs');
  const run = (args) =>
    spawnSync(process.execPath, [script, ...args], { cwd: repoRoot, encoding: 'utf8' });

  const help = run(['--help']);
  assert.equal(help.status, 0, help.stderr || help.stdout);
  assert.match(help.stdout, /--model minimax-h3-r2v-prism/);
  assert.match(help.stdout, /needs\s+--disable-safe-content-filter/);

  const filterOn = run(['--mode', 'r2v', '--model', 'minimax-h3-r2v-prism', '--no-interactive']);
  assert.equal(filterOn.status, 1);
  assert.match(
    filterOn.stderr,
    /MiniMax H3 Prism R2V is a sensitive-content model and requires the explicit --disable-safe-content-filter option\./
  );

  const noPrompt = run([
    '--mode',
    'r2v',
    '--model',
    'minimax-h3-r2v-prism',
    '--ref-image',
    path.join(repoRoot, 'scripts', 'check-minimax-h3-prism.cjs'),
    '--disable-safe-content-filter',
    '--print-prompt',
    '--no-interactive'
  ]);
  assert.equal(noPrompt.status, 1, noPrompt.stdout);
  assert.match(
    noPrompt.stderr,
    /A prompt must be supplied with --prompt-file for MiniMax H3 Prism R2V/
  );

  console.log('MiniMax H3 Prism SDK checks passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
