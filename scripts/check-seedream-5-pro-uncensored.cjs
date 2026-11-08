'use strict';

// Seedream 5.0 Pro Uncensored (`seedream-5-0-pro-uncensored`): an external
// API image model for text-to-image and edits from 1-10 reference images, with
// no negative prompt, seed or steps. It shares the Seedance 2.5 Uncensored
// agreement, so a hosted tool call only lands on it when the call names it.

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const sdk = require('../dist/index.js');
const { SogniTools } = require('../dist/Chat/tools.js');
const {
  PREFERRED_MODEL_IDS,
  assertHostedToolArguments,
  isEditImageModel,
  resolveHostedToolModelSelector
} = require('../dist/Chat/modelRouting.js');
const ChatToolsApi = require('../dist/Chat/ChatTools.js').default;
const createJobRequestMessage = require('../dist/Projects/createJobRequestMessage.js').default;
const {
  getMaxContextImages,
  isComfyModel,
  isGptImageModel,
  isSeedreamModel,
  validateCustomImageSize,
  validateSeedreamOptions
} = require('../dist/lib/validation.js');

const SEEDREAM = 'seedream-5-0-pro-uncensored';

// Identity: one canonical id, exported from the package root.
assert.equal(sdk.SEEDREAM_5_PRO_UNCENSORED_MODEL_ID, SEEDREAM);
assert.equal(sdk.isSeedreamModel, isSeedreamModel);
assert.equal(PREFERRED_MODEL_IDS.image.seedream5ProUncensored, SEEDREAM);
assert.equal(isSeedreamModel(SEEDREAM), true);
for (const other of [
  'seedream-5-0-pro',
  'seedream-5-0-flash-uncensored',
  'seedream-5-0-pro-uncensored-v2',
  'seedream',
  'seedance-2-5-uncensored',
  'gpt-image-2',
  undefined
]) {
  assert.equal(isSeedreamModel(other), false, `${other} is not Seedream 5.0 Pro Uncensored`);
}
assert.equal(isGptImageModel(SEEDREAM), false);
assert.equal(isComfyModel(SEEDREAM), false);
assert.equal(sdk.isVideoModel(SEEDREAM), false);
assert.equal(isEditImageModel(SEEDREAM), true);
assert.equal(getMaxContextImages(SEEDREAM), 10);
// GPT Image keeps its own limits.
assert.equal(getMaxContextImages('gpt-image-2'), 16);

// Hosted selectors: the display names and search aliases resolve on both image
// tools; a bare "seedream" is not claimed for the uncensored model.
for (const tool of ['generate_image', 'edit_image']) {
  for (const selector of [
    SEEDREAM,
    'Seedream 5.0 Pro Uncensored',
    'Seedream 5 Pro Uncensored',
    'seedream_uncensored',
    'Seedream 5 Pro Spicy',
    'Seedream 5.0 Pro Spicy'
  ]) {
    assert.equal(resolveHostedToolModelSelector(tool, { model: selector }), SEEDREAM, selector);
  }
  assert.equal(resolveHostedToolModelSelector(tool, { model: 'seedream' }), 'seedream');
  assertHostedToolArguments(SogniTools.all, tool, { prompt: 'A portrait', model: SEEDREAM });
}

// Sizes: the 1K, 1536 and 2K tables all pass; the limits are 921,600 to
// 4,194,304 pixels at an aspect ratio from 1:16 to 16:1.
const options = {
  type: 'image',
  steps: { min: 1, max: 1, step: 1, default: 1 },
  guidance: { min: 0, max: 1, step: 0.1, default: 0 },
  sampler: { allowed: [], default: null },
  scheduler: { allowed: [], default: null }
};
const request = (params) =>
  createJobRequestMessage(
    'seedream-wire',
    {
      type: 'image',
      modelId: SEEDREAM,
      positivePrompt: 'A portrait in window light',
      numberOfMedia: 1,
      ...params
    },
    options
  );
// Existing image outputFormat is forwarded unchanged; omitted stays PNG.
for (const outputFormat of [undefined, 'png', 'jpg', 'webp']) {
  for (const contextImages of [undefined, ['reference-image']]) {
    assert.equal(request({ outputFormat, contextImages }).outputFormat, outputFormat || 'png');
  }
}
for (const [width, height] of [
  [1024, 1024],
  [1152, 864],
  [864, 1152],
  [1280, 720],
  [720, 1280],
  [1248, 832],
  [832, 1248],
  [1512, 648],
  [1536, 1536],
  [2048, 2048],
  [2304, 1728],
  [1728, 2304],
  [2560, 1440],
  [1440, 2560],
  [2496, 1664],
  [1664, 2496],
  [3024, 1296],
  // The extremes the pixel and aspect-ratio limits allow.
  [3840, 240],
  [8192, 512]
]) {
  const keyFrame = request({ sizePreset: 'custom', width, height }).keyFrames[0];
  assert.equal(keyFrame.width, width);
  assert.equal(keyFrame.height, height);
}
assert.equal(validateCustomImageSize(8192, { modelId: SEEDREAM }), 8192);
assert.equal(validateCustomImageSize(240, { modelId: SEEDREAM }), 240);
assert.throws(() => validateCustomImageSize(8193, { modelId: SEEDREAM }), /less or equal 8192/);
assert.throws(() => validateCustomImageSize(239, { modelId: SEEDREAM }), /greater or equal 240/);
for (const [width, height] of [
  [1024, 768], // 786,432 pixels
  [2048, 2049], // 4,196,352 pixels
  [4096, 240] // wider than 16:1
]) {
  assert.throws(
    () => request({ width, height }),
    /renders 921,600 to 4,194,304 pixels at an aspect ratio from 1:16 to 16:1/,
    `${width}x${height}`
  );
}
// A named size preset is resolved by the server, not checked here.
assert.doesNotThrow(() =>
  validateSeedreamOptions({ modelId: SEEDREAM, sizePreset: 'square_hd', width: 512, height: 512 })
);
// Other models keep their own size checks.
assert.doesNotThrow(() =>
  validateSeedreamOptions({ modelId: 'gpt-image-2', width: 512, height: 512 })
);

// References: up to 10, in source order, none empty.
{
  const references = Array.from({ length: 10 }, (_, index) => `ref-${index + 1}`);
  const keyFrame = request({ contextImages: references }).keyFrames[0];
  assert.equal(keyFrame.hasContextImage10, true);
  assert.equal(keyFrame.hasContextImage11, false);
  assert.throws(
    () => request({ contextImages: [...references, 'ref-11'] }),
    /accepts up to 10 non-empty reference images in source order/
  );
  assert.throws(
    () => request({ contextImages: ['ref-1', null] }),
    /accepts up to 10 non-empty reference images in source order/
  );
}

// No negative prompt reaches the job, even an empty template one. GPT Image
// keeps sending the negative prompt it always has.
{
  const keyFrame = request({ negativePrompt: 'blurry' }).keyFrames[0];
  assert.equal('negativePrompt' in keyFrame, false);
  assert.equal(keyFrame.modelID, SEEDREAM);
  const gptKeyFrame = createJobRequestMessage(
    'gpt-wire',
    {
      type: 'image',
      modelId: 'gpt-image-2',
      positivePrompt: 'A portrait',
      negativePrompt: 'blurry',
      numberOfMedia: 1
    },
    options
  ).keyFrames[0];
  assert.equal(gptKeyFrame.negativePrompt, 'blurry');
}

// Hosted tool calls.
async function checkToolExecution() {
  const tinyPng =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  let captured;
  const image = (id, workerCount) => ({ id, media: 'image', workerCount });
  const toolsFor = (available) =>
    new ChatToolsApi({
      waitForModels: async () => available,
      create: async (params) => {
        captured = params;
        const project = new EventEmitter();
        project.id = 'project_seedream_test';
        project.jobs = [];
        project.finished = false;
        project.waitForCompletion = async () => ['https://cdn.sogni.ai/seedream-test.png'];
        project.cancel = async () => {};
        return project;
      }
    });
  const call = (name, args) => ({
    id: `call_${name}_seedream_test`,
    type: 'function',
    function: { name, arguments: JSON.stringify({ prompt: 'A portrait', ...args }) }
  });
  // External API models report nine workers; the worker-count tiebreak must
  // never pick the agreement-gated model for a call that names no model.
  const pool = [
    image(SEEDREAM, 50),
    image('gpt-image-2', 9),
    image('z_image_turbo_bf16', 3),
    image('qwen_image_edit_2511_fp8_lightning', 1)
  ];
  const tools = toolsFor(pool);

  captured = undefined;
  let result = await tools.execute(call('generate_image', {}));
  assert.equal(result.success, true, result.error);
  assert.equal(captured.modelId, 'gpt-image-2');

  captured = undefined;
  result = await tools.execute(call('edit_image', { source_image_url: tinyPng }));
  assert.equal(result.success, true, result.error);
  assert.equal(captured.modelId, 'gpt-image-2');

  captured = undefined;
  result = await toolsFor([image(SEEDREAM, 9)]).execute(call('generate_image', {}));
  assert.equal(result.success, false);
  assert.match(result.error, /No compatible image models currently available/);
  assert.equal(captured, undefined);

  // Named, it is chosen, and takes no negative prompt, seed or steps.
  captured = undefined;
  result = await tools.execute(
    call('generate_image', {
      model: 'Seedream 5.0 Pro Uncensored',
      negative_prompt: 'blurry',
      seed: 7,
      steps: 30,
      width: 2048,
      height: 2048
    })
  );
  assert.equal(result.success, true, result.error);
  assert.equal(captured.modelId, SEEDREAM);
  assert.equal(captured.width, 2048);
  assert.equal(captured.sizePreset, 'custom');
  for (const key of ['negativePrompt', 'seed', 'steps']) {
    assert.equal(key in captured, false, `${key} is not sent to Seedream`);
  }

  captured = undefined;
  result = await tools.execute(
    call('edit_image', {
      model: SEEDREAM,
      source_image_url: tinyPng,
      reference_image_urls: [tinyPng],
      negative_prompt: 'blurry',
      seed: 7
    })
  );
  assert.equal(result.success, true, result.error);
  assert.equal(captured.modelId, SEEDREAM);
  assert.equal(captured.contextImages.length, 2);
  assert.equal('negativePrompt' in captured, false);
  assert.equal('seed' in captured, false);

  captured = undefined;
  result = await tools.execute(
    call('edit_image', {
      model: SEEDREAM,
      source_image_url: tinyPng,
      reference_image_urls: Array.from({ length: 10 }, () => tinyPng)
    })
  );
  assert.equal(result.success, false);
  assert.match(result.error, /accepts at most 10 reference images; this request supplies 11/);
  assert.equal(captured, undefined);

  // Other models still receive the negative prompt, seed and steps.
  captured = undefined;
  result = await tools.execute(
    call('generate_image', { model: 'gpt-image-2', negative_prompt: 'blurry', seed: 7, steps: 30 })
  );
  assert.equal(result.success, true, result.error);
  assert.equal(captured.negativePrompt, 'blurry');
  assert.equal(captured.seed, 7);
  assert.equal(captured.steps, 30);
}

// Explicit extraction is opt-in and requires exactly one source and one result.
for (const seedreamLayerSize of ['1K', '1.5K', '2K']) {
  const params = {
    ...options,
    modelId: SEEDREAM,
    contextImages: ['ref'],
    numberOfMedia: 1,
    seedreamLayerDecomposition: true,
    seedreamLayerSize
  };
  validateSeedreamOptions(params);
  const key = request(params).keyFrames[0];
  assert.equal(key.seedreamLayerSize, seedreamLayerSize);
  assert.equal(key.seedreamLayerDecomposition, true);
}
assert.throws(
  () => validateSeedreamOptions({ modelId: SEEDREAM, seedreamLayerDecomposition: true }),
  /exactly one reference/
);
assert.throws(
  () =>
    validateSeedreamOptions({
      modelId: SEEDREAM,
      seedreamLayerDecomposition: true,
      contextImages: ['a', 'b']
    }),
  /exactly one reference/
);
assert.throws(
  () =>
    validateSeedreamOptions({
      modelId: SEEDREAM,
      seedreamLayerDecomposition: true,
      contextImages: ['a'],
      seedreamLayerSize: 'auto'
    }),
  /1K, 1.5K or 2K/
);
// A completed layer decomposition: the base is resultUrl, the layers ride on
// the jobResult and land on the Job and its completed event, ordered by zIndex.
async function checkLayerResults() {
  const { imageLayersFromResult } = require('../dist/Projects/utils/imageLayers.js');
  const ProjectsApi = require('../dist/Projects/index.js').default;
  const layer = (zIndex, extra = {}) => ({
    url: `https://cdn.sogni.ai/layer-${zIndex}.png`,
    key: `vendor/bytedance/seedream-5-0-pro-uncensored/2026-10-22/job.layer-${zIndex}.png`,
    width: 1000 + zIndex,
    height: 800,
    zIndex,
    boundingBox: { absolute: [0, 0, 1000 + zIndex, 800], normalized: [0, 0, 596, 999] },
    name: `Layer ${zIndex}`,
    description: `Layer ${zIndex} description`,
    ...extra
  });
  const expected = (zIndex) => {
    const { key, ...rest } = layer(zIndex);
    return rest;
  };
  assert.equal(imageLayersFromResult(undefined), undefined);
  assert.equal(imageLayersFromResult([]), undefined);
  assert.deepEqual(imageLayersFromResult([layer(2), layer(1)]), [expected(1), expected(2)]);
  // A layer without its required fields is not reported as one.
  assert.deepEqual(imageLayersFromResult([layer(1, { url: '' }), layer(2)]), [expected(2)]);

  class SocketStub extends EventEmitter {
    async send() {}
  }
  class ClientStub extends EventEmitter {
    constructor() {
      super();
      this.socket = new SocketStub();
      this.logger = { debug() {}, info() {}, warn() {}, error() {} };
    }
    resolveWorkloadAttribution() {
      return undefined;
    }
  }
  const client = new ClientStub();
  const projects = new ProjectsApi({ client, eip712: {} });
  projects.getModelOptions = async () => options;
  const completedEvents = [];
  projects.on('job', (event) => {
    if (event.type === 'completed') completedEvents.push(event);
  });
  const project = await projects.create({
    type: 'image',
    modelId: SEEDREAM,
    positivePrompt: 'Separate the figure and the background',
    numberOfMedia: 1,
    contextImages: [true],
    seedreamLayerDecomposition: true
  });
  client.socket.emit('jobState', {
    type: 'jobStarted',
    jobID: project.id,
    imgID: 'seedream-layers-1',
    workerName: ''
  });
  client.socket.emit('jobResult', {
    jobID: project.id,
    imgID: 'seedream-layers-1',
    resultUrl: 'https://cdn.sogni.ai/base.jpg',
    outputFormat: 'jpeg',
    performedStepCount: 1,
    lastSeed: '-1',
    triggeredNSFWFilter: false,
    userCanceled: false,
    layers: [layer(3), layer(1), layer(2)]
  });
  await new Promise((resolve) => setImmediate(resolve));
  const job = project.job('seedream-layers-1');
  assert.equal(job.resultUrl, 'https://cdn.sogni.ai/base.jpg');
  assert.deepEqual(job.layers, [expected(1), expected(2), expected(3)]);
  assert.equal(completedEvents.length, 1);
  assert.deepEqual(completedEvents[0].layers, [expected(1), expected(2), expected(3)]);

  const downloads = [];
  projects.downloadUrl = async (params) => {
    downloads.push(params);
    return `https://cdn.sogni.ai/fresh-layer-${params.layerIndex}.png`;
  };
  assert.equal(await job.getLayerUrl(2), 'https://cdn.sogni.ai/fresh-layer-2.png');
  assert.deepEqual(downloads, [
    { jobId: project.id, imageId: job.id, type: 'complete', layerIndex: 2 }
  ]);
  await assert.rejects(job.getLayerUrl(16), /Layer is not available/);
  assert.equal(downloads.length, 1);

  // An ordinary result carries no layers.
  const plainProject = await projects.create({
    type: 'image',
    modelId: SEEDREAM,
    positivePrompt: 'A portrait',
    numberOfMedia: 1
  });
  client.socket.emit('jobState', {
    type: 'jobStarted',
    jobID: plainProject.id,
    imgID: 'seedream-plain-1',
    workerName: ''
  });
  client.socket.emit('jobResult', {
    jobID: plainProject.id,
    imgID: 'seedream-plain-1',
    resultUrl: 'https://cdn.sogni.ai/plain.png',
    performedStepCount: 1,
    lastSeed: '-1',
    triggeredNSFWFilter: false,
    userCanceled: false
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(plainProject.job('seedream-plain-1').layers, undefined);
  assert.equal('layers' in completedEvents[1], false);

  // A REST sync of a finished job reads the layers from its stored result.
  const synced = project.job('seedream-layers-1');
  synced._update({ layers: undefined });
  await synced._syncWithRestData({
    imgID: 'seedream-layers-1',
    status: 'jobCompleted',
    performedSteps: 1,
    worker: {},
    resultUrl: 'https://cdn.sogni.ai/base.jpg',
    result: { layers: [layer(2), layer(1)] }
  });
  assert.deepEqual(synced.layers, [expected(1), expected(2)]);

  // The quote asks for the layer-decomposition ceiling only when asked to.
  const estimatePaths = [];
  projects.getModelOptions = async () => options;
  client.socket.get = async (path) => {
    estimatePaths.push(path);
    return {
      quote: { project: { costInToken: '1', costInUSD: '1', costInSpark: '1', costInSogni: '1' } }
    };
  };
  const base = {
    model: SEEDREAM,
    imageCount: 1,
    stepCount: 1,
    previewCount: 0,
    width: 1536,
    height: 1536,
    contextImages: 1
  };
  await projects.estimateCost(base);
  await projects.estimateCost({ ...base, seedreamLayerDecomposition: true });
  assert.equal(estimatePaths[0].includes('seedreamLayerDecomposition'), false);
  assert.match(estimatePaths[1], /[?&]seedreamLayerDecomposition=true(&|$)/);

  project._update({ status: 'failed', error: { code: 0, message: 'test cleanup' } });
  plainProject._update({ status: 'failed', error: { code: 0, message: 'test cleanup' } });
}

checkToolExecution()
  .then(checkLayerResults)
  .then(() =>
    console.log(
      'Seedream 5.0 Pro Uncensored identity, selectors, sizes, references, layers and tool calls passed'
    )
  )
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
