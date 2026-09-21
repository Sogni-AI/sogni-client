const assert = require('node:assert/strict');
const request = require('../dist/Projects/createJobRequestMessage.js').default;
const Job = require('../dist/Projects/Job.js').default;
const options = {
  type: 'image',
  steps: { min: 1, max: 60, default: 20 },
  guidance: { min: 0, max: 30, default: 7 },
  sampler: { allowed: [], default: null },
  scheduler: { allowed: [], default: null }
};
const params = {
  type: 'image',
  modelId: 'coreml-sogni_artist_v1_768',
  positivePrompt: 'A ceramic mug',
  numberOfMedia: 1,
  seed: 0
};
for (const outputFormat of ['png', 'jpg', 'webp']) {
  for (const embedPromptMetadata of [undefined, false, true]) {
    const wire = request('image-export', { ...params, outputFormat, embedPromptMetadata }, options);
    assert.equal(wire.outputFormat, outputFormat);
    assert.equal(wire.embedPromptMetadata, embedPromptMetadata);
    assert.equal(Object.hasOwn(wire, 'embedPromptMetadata'), embedPromptMetadata !== undefined);
    assert.equal(wire.keyFrames[0].seed, 0);
  }
}
for (const [startingImageStrength, denoise] of [
  [0, 1],
  [1, 0],
  [0.25, 0.75],
  [undefined, 0.5]
]) {
  const wire = request(
    'image-strength',
    { ...params, startingImage: true, startingImageStrength },
    options
  );
  assert.equal(wire.keyFrames[0].strength, denoise);
}
assert.throws(
  () => request('invalid', { ...params, embedPromptMetadata: 'false' }, options),
  /must be a boolean/
);
async function main() {
  let enhanced;
  const job = new Job(
    {
      id: 'image',
      projectId: 'project',
      status: 'completed',
      seed: 0,
      nsfwDetected: true,
      nsfwSources: ['prompt']
    },
    {
      project: { params: { ...params, seed: 42 } },
      logger: { debug() {} },
      api: {
        isVideoModelId: () => false,
        isAudioModelId: () => false,
        isModelArtifactModelId: () => false,
        create: async (value) => {
          enhanced = value;
          return { on() {}, waitForCompletion: async () => ['image-url'] };
        }
      }
    }
  );
  job.getResultData = async () => new Blob(['image']);
  assert.equal(job.isWithheld, false);
  assert.equal(job.nsfwDetected, true);
  const sources = job.nsfwSources;
  sources.push('image');
  assert.deepEqual(job.nsfwSources, ['prompt']);
  await job.enhance('medium');
  assert.equal(enhanced.seed, 0);
  console.log('Image export, zero strength/seed, and sensitive-label checks passed');
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
