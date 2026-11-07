const assert = require('node:assert/strict');
const create = require('../dist/Projects/createJobRequestMessage.js').default;
const { validateGptImageOptions } = require('../dist/lib/validation.js');
const { SogniTools } = require('../dist/Chat/tools.js');
const { assertHostedToolArguments, resolveHostedToolModelSelector } = require('../dist/Chat/modelRouting.js');
const options = { type: 'image', steps: { min: 1, max: 1, default: 1 }, guidance: { min: 0, max: 1, default: 1 }, sampler: { allowed: [], default: null }, scheduler: { allowed: [], default: null } };
for (const modelId of ['gpt-image-2.6-sunburst', 'gpt-image-2.6-flare']) {
  const args = { model: modelId, prompt: 'A lantern gently sways in a seamless loop', outputFormat: 'gif', gptImageFrameCount: 9, gptImageFrameDurationMs: 200, gptImageComplexity: 'medium' };
  assert.equal(resolveHostedToolModelSelector('generate_image', args), modelId);
  assertHostedToolArguments(SogniTools.all, 'generate_image', args, { skipEnumProperties: [] });
  const request = create('gif-wire', { ...args, modelId, type: 'image', positivePrompt: args.prompt, numberOfMedia: 1 }, options);
  assert.equal(request.outputFormat, 'gif');
  assert.equal(request.keyFrames[0].width, 896);
  assert.equal(request.keyFrames[0].height, 896);
  assert.equal(request.keyFrames[0].gptImageFrameCount, 9);
  assert.equal(request.keyFrames[0].gptImageFrameDurationMs, 200);
  assert.equal(request.keyFrames[0].gptImageComplexity, 'medium');
  const small = create('small-gif-wire', { modelId, type: 'image', positivePrompt: args.prompt, numberOfMedia: 1, outputFormat: 'gif', width: 320, height: 320 }, options);
  assert.equal(small.keyFrames[0].width, 320);
  const references = [Buffer.from('first reference'), Buffer.from('second reference')];
  const edit = create('reference-gif-wire', { modelId, type: 'image', positivePrompt: args.prompt, numberOfMedia: 1, outputFormat: 'gif', width: 320, height: 320, contextImages: references }, options);
  assert.equal(edit.keyFrames[0].hasContextImage1, true);
  assert.equal(edit.keyFrames[0].hasContextImage2, true);
  assert.equal(edit.keyFrames[0].width, 320);
  assert.equal(edit.outputFormat, 'gif');
  for (const extra of [{ gptImageMask: Buffer.from('mask') }, { gptImageMaskUrl: 'https://example.test/mask.png' }, { gptImageMarkupUrl: 'https://example.test/overlay.png' }]) {
    assert.throws(() => validateGptImageOptions({ modelId, outputFormat: 'gif', contextImages: references, ...extra }), /masks or markup/);
  }
  assert.throws(() => validateGptImageOptions({ modelId, outputFormat: 'gif', width: 1024, height: 1024 }), /pixel budget/);
  assert.throws(() => validateGptImageOptions({ modelId, outputFormat: 'png', gptImageFrameCount: 9 }), /require GIF/);
  assert.throws(() => validateGptImageOptions({ modelId, gptImageMarkupUrl: 'https://example.test/overlay.png' }), /first edit reference/);
}
for (const modelId of ['gpt-image-2', 'gpt-image-2.5-sunburst', 'gpt-image-2.5-flare', 'z_image_turbo_bf16']) {
  assert.throws(() => validateGptImageOptions({ modelId, outputFormat: 'gif' }), /require GPT Image 2.6/);
}
console.log('GPT Image 2.6: hosted contract, concrete GIF defaults, wire options and pre-send validation passed');

(async () => {
  const canonicalFormat = require('@sogni-ai/sogni-protocol/schemas/tools/generate_image.schema.json').properties.outputFormat;
  const esm = await import('../dist-esm/index.js');
  for (const sdk of [require('../dist/index.js'), esm]) {
    const format = sdk.SogniTools.generateImage.function.parameters.properties.outputFormat;
    assert.equal(format.description, canonicalFormat.description);
    assert.match(format.description, /GIF requires GPT Image 2\.6 text-to-image/);
    assert.ok(format.enum.includes('gif'));
  }
  const Projects = require('../dist/Projects/index.js').default;
  for (const input of [{}, { sizePreset: 'custom' }, { width: 320, height: 320, sizePreset: '1024x1024' }, { contextImages: 2 }]) {
    let path;
    await Projects.prototype.estimateCost.call({
      getModelOptions: async () => options,
      getSizePresets: async () => { throw new Error('GIF custom sizes must not be replaced by presets'); },
      client: { socket: { get: async url => { path = url; return { quote: { project: {} } }; } } }
    }, { model: 'gpt-image-2.6-flare', imageCount: 1, stepCount: 1, previewCount: 0, outputFormat: 'gif', gptImageFrameCount: 9, gptImageFrameDurationMs: 200, gptImageComplexity: 'low', ...input });
    const size = input.width ?? 896;
    assert.ok(path.includes(`/0/0/${size}/${size}${input.contextImages ? '/0/_/2' : ''}?`), path);
    assert.ok(path.includes('gptImageFrameCount=9'));
    assert.ok(path.includes('gptImageFrameDurationMs=200'));
    assert.ok(path.includes('gptImageComplexity=low'));
  }
  console.log('GIF estimate URLs preserve concrete create sizes and all frame controls');
})().catch(error => { console.error(error); process.exitCode = 1; });

const { getGptImageGifSheet, resolveGptImageGifSize } = require('../dist/index.js');
assert.throws(() => getGptImageGifSheet(1280, 1280, 5), /supported sheet/);
assert.throws(() => getGptImageGifSheet(16, 16, 9), /supported sheet/);
assert.deepEqual(getGptImageGifSheet(640, 640, 2), { columns: 4, rows: 2, width: 2560, height: 1280 });
assert.deepEqual(resolveGptImageGifSize(undefined, undefined, 16, 3), { width: 960, height: 320 });
for (let count = 2; count <= 16; count++) for (const ratio of [1/3, 9/16, 3/4, 1, 4/3, 16/9, 3]) {
  const size = resolveGptImageGifSize(undefined, undefined, count, ratio);
  const sheet = getGptImageGifSheet(size.width, size.height, count);
  assert.ok(sheet.width <= 3840 && sheet.height <= 3840 && sheet.width * sheet.height <= 8294400);
}
console.log('GIF sheet admission rejects provider failures and fits all count/aspect defaults');
