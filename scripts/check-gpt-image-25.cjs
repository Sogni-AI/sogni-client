const assert = require('node:assert/strict');
const { SogniTools } = require('../dist/Chat/tools.js');
const {
  resolveHostedToolModelSelector,
  isEditImageModel,
  assertHostedToolArguments
} = require('../dist/Chat/modelRouting.js');
const createJobRequestMessage = require('../dist/Projects/createJobRequestMessage.js').default;
const { validateCustomImageSize, validateGptImageOptions } = require('../dist/lib/validation.js');

for (const modelId of ['gpt-image-2', 'gpt-image-2.5-sunburst', 'gpt-image-2.5-flare']) {
  for (const tool of ['generate_image', 'edit_image']) {
    const args = { prompt: 'A ceramic mug', model: modelId, gptImageQuality: 'medium' };
    assert.equal(resolveHostedToolModelSelector(tool, args), modelId);
    assertHostedToolArguments(SogniTools.all, tool, args, { skipEnumProperties: [] });
  }
  assert.equal(isEditImageModel(modelId), true);
  assert.equal(validateCustomImageSize(3840, { modelId }), 3840);
}
for (const [alias, expected] of [
  ['Sunburst', 'gpt-image-2.5-sunburst'],
  ['GPT Image 2.5 Flare', 'gpt-image-2.5-flare'],
  ['GPT Image 2.5', 'gpt-image-2.5-flare'],
  ['OpenAI', 'gpt-image-2'],
  ['GPT Image 2.0', 'gpt-image-2']
]) {
  for (const tool of ['generate_image', 'edit_image']) {
    assert.equal(resolveHostedToolModelSelector(tool, { model: alias }), expected);
  }
}
const options = {
  type: 'image',
  steps: { min: 1, max: 1, step: 1, default: 1 },
  guidance: { min: 0, max: 1, step: 0.1, default: 0 },
  sampler: { allowed: [], default: null },
  scheduler: { allowed: [], default: null }
};
for (const modelId of ['gpt-image-2.5-sunburst', 'gpt-image-2.5-flare']) {
  for (const quality of ['low', 'medium', 'high', 'xhigh', 'max']) {
    const args = {
      prompt: 'A ceramic mug',
      model: modelId,
      gptImageQuality: quality,
      gptImageBackground: 'transparent',
      gptImageOutputCompression: 80,
      outputFormat: 'webp'
    };
    assertHostedToolArguments(SogniTools.all, 'generate_image', args, { skipEnumProperties: [] });
    assertHostedToolArguments(SogniTools.all, 'edit_image', args, { skipEnumProperties: [] });
    const request = createJobRequestMessage(
      'gpt-25-wire',
      {
        type: 'image',
        modelId,
        positivePrompt: args.prompt,
        numberOfMedia: 1,
        sizePreset: 'custom',
        width: 1024,
        height: 1024,
        gptImageQuality: quality,
        gptImageBackground: args.gptImageBackground,
        gptImageOutputCompression: 80,
        outputFormat: 'webp'
      },
      options
    );
    assert.equal(request.keyFrames[0].modelID, modelId);
    assert.equal(request.keyFrames[0].gptImageQuality, quality);
    assert.equal(request.keyFrames[0].gptImageBackground, 'transparent');
    assert.equal(request.keyFrames[0].gptImageOutputCompression, 80);
    assert.equal(request.outputFormat, 'webp');
  }
}
console.log('GPT Image 2.5 selectors, schemas, dimensions and wire controls passed');
assert.throws(
  () => validateGptImageOptions({ modelId: 'gpt-image-2', gptImageQuality: 'max' }),
  /Unsupported quality/
);
// Provider-chosen quality is never accepted, on any GPT Image model.
for (const modelId of ['gpt-image-2', 'gpt-image-2.5-sunburst', 'gpt-image-2.5-flare']) {
  assert.throws(
    () => validateGptImageOptions({ modelId, gptImageQuality: 'auto' }),
    /Unsupported quality/
  );
}
assert.throws(
  () => validateGptImageOptions({ modelId: 'gpt-image-2', gptImageBackground: 'transparent' }),
  /Unsupported background/
);
assert.throws(
  () =>
    validateGptImageOptions({
      modelId: 'gpt-image-2.5-flare',
      gptImageBackground: 'transparent',
      outputFormat: 'jpg'
    }),
  /requires PNG or WebP/
);
assert.throws(
  () =>
    validateGptImageOptions({
      modelId: 'gpt-image-2.5-flare',
      gptImageOutputCompression: 80,
      outputFormat: 'png'
    }),
  /requires JPEG or WebP/
);
assert.throws(
  () =>
    validateGptImageOptions({
      modelId: 'gpt-image-2.5-flare',
      gptImageOutputCompression: 101,
      outputFormat: 'webp'
    }),
  /integer from 0 to 100/
);

async function verifyMaskUpload() {
  const { EventEmitter } = require('node:events');
  const ProjectsApi = require('../dist/Projects/index.js').default;
  const client = new EventEmitter();
  client.socket = new EventEmitter();
  client.logger = { debug() {}, info() {}, warn() {}, error() {} };
  client.resolveWorkloadAttribution = () => undefined;
  const sent = [];
  client.socket.send = async (type, data) => sent.push({ type, data });
  const projects = new ProjectsApi({ client, eip712: {} });
  projects.getModelOptions = async () => options;
  const uploads = [];
  projects.uploadReferenceMask = async (id, media) =>
    uploads.push(['mask', Buffer.from(await media.arrayBuffer())]);
  projects.uploadContextImage = async (id, index, media) => uploads.push([index, media]);
  const original = Buffer.from('original mask bytes');
  const refs = Array.from({ length: 16 }, (_, index) => Buffer.from(`reference ${index + 1}`));
  for (const modelId of ['gpt-image-2.5-sunburst', 'gpt-image-2.5-flare']) {
    uploads.length = 0;
    const params = {
      type: 'image',
      modelId,
      positivePrompt: 'Edit the first image',
      numberOfMedia: 1,
      width: 1024,
      height: 1024,
      sizePreset: 'custom',
      contextImages: refs,
      gptImageMaskUrl: `data:image/png;base64,${original.toString('base64')}`,
      gptImageQuality: 'max'
    };
    const project = await projects.create(params);
    assert.deepEqual(uploads[0], ['mask', original]);
    assert.deepEqual(
      uploads.slice(1),
      refs.map((ref, i) => [i, ref])
    );
    const frame = sent.at(-1).data.keyFrames[0];
    assert.equal(frame.hasReferenceMask, true);
    assert.equal(frame.gptImageMaskUrl, undefined);
    assert.equal(frame.referenceMaskContentType, 'image/png');
    assert.equal(frame.hasContextImage16, true);
    assert.equal(frame.hasContextImage17, undefined);
    const before = uploads.length;
    await assert.rejects(projects.create({ ...params, contextImages: [...refs, refs[0]] }), /16/);
    await assert.rejects(projects.create({ ...params, contextImages: [] }), /first reference/);
    await assert.rejects(projects.create({ ...params, gptImageMask: true }), /one GPT Image mask/);
    assert.equal(uploads.length, before);
    project._update({ status: 'failed', error: { code: 0, message: 'test cleanup' } });
  }
  console.log(
    'GPT Image masks upload byte-for-byte; 16 ordered references and invalid requests verified'
  );
}
// A create() rejected by createJobRequestMessage has already constructed its
// Project, whose timeout interval is never cleared; exit explicitly.
verifyMaskUpload().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  }
);
