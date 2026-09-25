'use strict';

// job.enhance() and estimateEnhancementCost(): the enhancer model, strength
// direction, and output size they send. FLUX.1 [schnell] ignored the source
// image and the Supernet now refuses Schnell guide images, so enhancement must
// never go back to it.
const assert = require('node:assert/strict');
const Job = require('../dist/Projects/Job.js').default;
const { enhancementDefaults } = require('../dist/Projects/Job.js');
const ProjectsApi = require('../dist/Projects/index.js').default;

const PRESETS = [
  { id: 'square_hd', label: 'Square HD', width: 1024, height: 1024, ratio: '1:1', aspect: '1' },
  { id: 'portrait_7_9', label: 'Portrait', width: 896, height: 1152, ratio: '7:9', aspect: '0.78' }
];

function jobStub(params) {
  const created = [];
  const presetCalls = [];
  const stub = Object.create(Job.prototype);
  Object.assign(stub, {
    _project: {
      params: {
        type: 'image',
        modelId: 'z_image_turbo_bf16',
        positivePrompt: 'a red fox',
        stylePrompt: '',
        ...params
      }
    },
    _enhancementProject: null,
    handleEnhancementUpdate() {},
    _api: {
      async getSizePresets(network, modelId) {
        presetCalls.push({ network, modelId });
        return PRESETS;
      },
      async create(request) {
        created.push(request);
        return {
          on() {},
          off() {},
          async waitForCompletion() {
            return ['https://example.test/enhanced.png'];
          }
        };
      }
    },
    getResultData: async () => new Uint8Array([1, 2, 3])
  });
  Object.defineProperty(stub, 'type', { value: 'image' });
  Object.defineProperty(stub, 'status', { value: 'completed' });
  Object.defineProperty(stub, 'isWithheld', { value: false });
  Object.defineProperty(stub, 'seed', { value: 42 });
  return { stub, created, presetCalls };
}

async function main() {
  assert.equal(enhancementDefaults.modelId, 'krea2_turbo_fp8_scaled');
  assert.equal(enhancementDefaults.steps, 8);
  assert.notEqual(enhancementDefaults.modelId, 'flux1-schnell-fp8');

  // Strength direction: SDK influence = 1 - denoise, so light keeps the most.
  const influence = {};
  for (const strength of ['light', 'medium', 'heavy']) {
    const { stub, created } = jobStub({ sizePreset: 'custom', width: 1152, height: 896 });
    assert.equal(await stub.enhance(strength), 'https://example.test/enhanced.png');
    const [request] = created;
    assert.equal(request.modelId, 'krea2_turbo_fp8_scaled');
    assert.equal(request.steps, 8);
    assert.equal(request.seed, 42);
    assert.equal(request.sizePreset, 'custom');
    assert.equal(request.width, 1152);
    assert.equal(request.height, 896);
    influence[strength] = request.startingImageStrength;
  }
  assert.ok(Math.abs(influence.light - 0.85) < 1e-9, `light influence ${influence.light}`);
  assert.ok(Math.abs(influence.medium - 0.65) < 1e-9, `medium influence ${influence.medium}`);
  assert.ok(Math.abs(influence.heavy - 0.51) < 1e-9, `heavy influence ${influence.heavy}`);

  // A preset belongs to the parent's model; it is resolved there and sent as a custom size.
  {
    const { stub, created, presetCalls } = jobStub({
      sizePreset: 'portrait_7_9',
      network: 'relaxed'
    });
    await stub.enhance('light');
    assert.deepEqual(presetCalls, [{ network: 'relaxed', modelId: 'z_image_turbo_bf16' }]);
    assert.equal(created[0].sizePreset, 'custom');
    assert.equal(created[0].width, 896);
    assert.equal(created[0].height, 1152);
  }
  // An unknown preset fails before anything is paid for.
  {
    const { stub, created } = jobStub({ sizePreset: 'no_such_preset' });
    await assert.rejects(
      stub.enhance('light'),
      /Size preset "no_such_preset" is not available for z_image_turbo_bf16/
    );
    assert.equal(created.length, 0);
  }
  // The parent's default size stays the enhancer's default size.
  {
    const { stub, created } = jobStub({});
    await stub.enhance('heavy');
    assert.equal(created[0].sizePreset, undefined);
    assert.equal(created[0].width, undefined);
  }

  // The quote must describe the same render job.enhance() submits.
  const quotes = [];
  const api = Object.create(ProjectsApi.prototype);
  api.estimateCost = async (request) => {
    quotes.push(request);
    return { token: '1' };
  };
  await api.estimateEnhancementCost('light', 'spark', { width: 1152, height: 896 });
  await api.estimateEnhancementCost('heavy');
  assert.equal(quotes[0].model, 'krea2_turbo_fp8_scaled');
  assert.equal(quotes[0].stepCount, 8);
  assert.ok(
    Math.abs(quotes[0].startingImageStrength - influence.light) < 1e-9,
    'light quote matches submission'
  );
  assert.equal(quotes[0].width, 1152);
  assert.equal(quotes[0].height, 896);
  assert.ok(
    Math.abs(quotes[1].startingImageStrength - influence.heavy) < 1e-9,
    'heavy quote matches submission'
  );
  assert.equal(quotes[1].width, undefined);

  console.log(
    'enhancement: Krea 2 Turbo model, strength direction, size resolution and matching quote passed'
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
