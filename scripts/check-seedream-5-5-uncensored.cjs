'use strict';

// Seedream 5.5 Uncensored (`seedream-5-5-uncensored`): an additive model with
// Seedream 5.0 Pro Uncensored's contract plus its own options. It must be
// recognised as Seedream everywhere (references, no sampling fields, chosen only
// by name), and every 5.0 Pro selector must keep naming 5.0 Pro. Only 5.5 takes
// sizes up to 4,624,220 pixels, `seedreamBackground`, `seedreamLayerMaxImages`
// and `seedreamLayerTextRecognition`; layer decomposition works on both.

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const sdk = require('../dist/index.js');
const {
  PREFERRED_MODEL_IDS,
  isEditImageModel,
  resolveHostedToolModelSelector
} = require('../dist/Chat/modelRouting.js');
const createJobRequestMessage = require('../dist/Projects/createJobRequestMessage.js').default;
const ProjectsApi = require('../dist/Projects/index.js').default;
const { imageLayersFromResult } = require('../dist/Projects/utils/imageLayers.js');
const {
  getMaxContextImages,
  isComfyModel,
  isGptImageModel,
  isSeedreamModel,
  validateCustomImageSize,
  validateSeedreamOptions
} = require('../dist/lib/validation.js');

const SEEDREAM_55 = 'seedream-5-5-uncensored';
const SEEDREAM_PRO = 'seedream-5-0-pro-uncensored';

assert.equal(sdk.SEEDREAM_5_5_UNCENSORED_MODEL_ID, SEEDREAM_55);
assert.equal(sdk.SEEDREAM_5_PRO_UNCENSORED_MODEL_ID, SEEDREAM_PRO);
assert.equal(PREFERRED_MODEL_IDS.image.seedream55Uncensored, SEEDREAM_55);
assert.equal(PREFERRED_MODEL_IDS.image.seedream5ProUncensored, SEEDREAM_PRO);
assert.equal(isSeedreamModel(SEEDREAM_55), true);
assert.equal(isSeedreamModel(SEEDREAM_PRO), true);
for (const other of ['seedream-5-5', 'seedream-5-5-uncensored-v2', 'seedream', undefined]) {
  assert.equal(isSeedreamModel(other), false, `${other} is not a Seedream model`);
}
assert.equal(isGptImageModel(SEEDREAM_55), false);
assert.equal(isComfyModel(SEEDREAM_55), false);
assert.equal(isEditImageModel(SEEDREAM_55), true);
assert.equal(getMaxContextImages(SEEDREAM_55), 10);
assert.equal(validateCustomImageSize(8192, { modelId: SEEDREAM_55 }), 8192);

for (const tool of ['generate_image', 'edit_image']) {
  for (const selector of [
    SEEDREAM_55,
    'Seedream 5.5 Uncensored',
    'Seedream 5.5 Spicy',
    'seedream-5-5-spicy'
  ]) {
    assert.equal(resolveHostedToolModelSelector(tool, { model: selector }), SEEDREAM_55, selector);
  }
  // 5.0 Pro's selectors are unchanged, including the unversioned one.
  for (const selector of [
    SEEDREAM_PRO,
    'Seedream 5.0 Pro Uncensored',
    'seedream_uncensored',
    'Seedream 5 Pro Spicy'
  ]) {
    assert.equal(resolveHostedToolModelSelector(tool, { model: selector }), SEEDREAM_PRO, selector);
  }
}

const options = {
  type: 'image',
  steps: { min: 1, max: 1, step: 1, default: 1 },
  guidance: { min: 0, max: 1, step: 0.1, default: 0 },
  sampler: { allowed: [], default: null },
  scheduler: { allowed: [], default: null }
};
const request = (params, modelId = SEEDREAM_55) =>
  createJobRequestMessage(
    'seedream-55-wire',
    { type: 'image', modelId, positivePrompt: 'A white cat in a bar', numberOfMedia: 1, ...params },
    options
  );
const keyFrameOf = (params, modelId) => request(params, modelId).keyFrames[0];
const seedreamKeys = (keyFrame) =>
  Object.keys(keyFrame).filter((key) => key.startsWith('seedream'));

// The vendor's own example size, beyond the generic 2048-px edge cap.
{
  const keyFrame = keyFrameOf({
    sizePreset: 'custom',
    width: 2512,
    height: 1664,
    negativePrompt: 'blurry'
  });
  assert.equal(keyFrame.width, 2512);
  assert.equal(keyFrame.height, 1664);
  assert.equal(keyFrame.negativePrompt, undefined);
  // No new option was set, so none is written.
  assert.deepEqual(seedreamKeys(keyFrame), []);
}
validateSeedreamOptions({
  type: 'image',
  modelId: SEEDREAM_55,
  contextImages: Array(10).fill('r')
});
assert.throws(
  () =>
    validateSeedreamOptions({
      type: 'image',
      modelId: SEEDREAM_55,
      contextImages: Array(11).fill('r')
    }),
  /accepts up to 10 non-empty reference images/
);

// Sizes: 921,600 to 4,624,220 pixels at 1:16 to 16:1, so edges run 240-8595 px.
// Every native 1K, 1.5K and 2K size passes.
for (const [width, height] of [
  [1024, 1024],
  [1152, 864],
  [864, 1152],
  [1424, 800],
  [800, 1424],
  [1248, 832],
  [832, 1248],
  [1568, 672],
  [1536, 1536],
  [1792, 1344],
  [1344, 1792],
  [2048, 1152],
  [1152, 2048],
  [1872, 1248],
  [1248, 1872],
  [2352, 1008],
  [2048, 2048],
  [2368, 1776],
  [1776, 2368],
  [2816, 1584],
  [1584, 2816],
  [2496, 1664],
  [1664, 2496],
  [3136, 1344],
  // The boundaries: exactly 4,624,220 pixels, and the extreme edges.
  [2830, 1634],
  [1634, 2830],
  [3840, 240],
  [8595, 538],
  [538, 8595]
]) {
  const keyFrame = keyFrameOf({ sizePreset: 'custom', width, height });
  assert.equal(keyFrame.width, width, `${width}x${height}`);
  assert.equal(keyFrame.height, height, `${width}x${height}`);
}
assert.equal(validateCustomImageSize(8595, { modelId: SEEDREAM_55 }), 8595);
assert.equal(validateCustomImageSize(240, { modelId: SEEDREAM_55 }), 240);
assert.throws(() => validateCustomImageSize(8596, { modelId: SEEDREAM_55 }), /less or equal 8595/);
assert.throws(() => validateCustomImageSize(239, { modelId: SEEDREAM_55 }), /greater or equal 240/);
for (const [width, height] of [
  [1024, 768], // 786,432 pixels
  [2830, 1635], // 4,626,850 pixels, just above the ceiling
  [2151, 2150], // 4,624,650 pixels
  [4096, 240] // wider than 16:1
]) {
  assert.throws(
    () => request({ sizePreset: 'custom', width, height }),
    /seedream-5-5-uncensored renders 921,600 to 4,624,220 pixels at an aspect ratio from 1:16 to 16:1/,
    `${width}x${height}`
  );
}
// The same 4,624,220-pixel request stays refused on 5.0 Pro.
assert.throws(
  () => request({ sizePreset: 'custom', width: 2830, height: 1634 }, SEEDREAM_PRO),
  /renders 921,600 to 4,194,304 pixels/
);

// Backgrounds: opaque, transparent and auto, written only when set.
for (const seedreamBackground of ['opaque', 'transparent', 'auto']) {
  for (const outputFormat of [undefined, 'png', 'webp']) {
    for (const contextImages of [undefined, ['ref'], Array(10).fill('ref')]) {
      const message = request({ seedreamBackground, outputFormat, contextImages });
      assert.equal(message.keyFrames[0].seedreamBackground, seedreamBackground);
      assert.deepEqual(seedreamKeys(message.keyFrames[0]), ['seedreamBackground']);
      assert.equal(message.outputFormat, outputFormat || 'png');
    }
  }
}
// An opaque JPEG is fine; transparency or auto in a JPEG is not.
assert.equal(
  keyFrameOf({ seedreamBackground: 'opaque', outputFormat: 'jpg' }).seedreamBackground,
  'opaque'
);
for (const seedreamBackground of ['transparent', 'auto']) {
  assert.throws(
    () => request({ seedreamBackground, outputFormat: 'jpg' }),
    /Transparent or auto Seedream background requires PNG or WebP output/,
    seedreamBackground
  );
}
for (const seedreamBackground of ['Transparent', 'none', '', true]) {
  assert.throws(
    () => request({ seedreamBackground }),
    /seedreamBackground must be opaque, transparent or auto/,
    String(seedreamBackground)
  );
}
// The background cannot combine with layer decomposition, whatever its value.
for (const seedreamBackground of ['opaque', 'transparent', 'auto']) {
  assert.throws(
    () => request({ seedreamBackground, seedreamLayerDecomposition: true, contextImages: ['ref'] }),
    /seedreamBackground cannot combine with seedreamLayerDecomposition/,
    seedreamBackground
  );
}
// An explicit non-decomposition still takes a background.
assert.equal(
  keyFrameOf({ seedreamBackground: 'transparent', seedreamLayerDecomposition: false })
    .seedreamBackground,
  'transparent'
);

// Layer decomposition on 5.5: one source, one result, a size tier, at most
// 2-100 images (base included) and optional text recognition.
const layerRequest = (params) =>
  keyFrameOf({ contextImages: ['poster'], seedreamLayerDecomposition: true, ...params });
{
  const keyFrame = layerRequest({});
  assert.deepEqual(seedreamKeys(keyFrame), ['seedreamLayerDecomposition']);
  assert.equal(keyFrame.seedreamLayerDecomposition, true);
}
for (const seedreamLayerSize of ['1K', '1.5K', '2K']) {
  for (const seedreamLayerMaxImages of [2, 8, 17, 100]) {
    for (const seedreamLayerTextRecognition of [true, false]) {
      const keyFrame = layerRequest({
        seedreamLayerSize,
        seedreamLayerMaxImages,
        seedreamLayerTextRecognition
      });
      assert.equal(keyFrame.seedreamLayerDecomposition, true);
      assert.equal(keyFrame.seedreamLayerSize, seedreamLayerSize);
      assert.equal(keyFrame.seedreamLayerMaxImages, seedreamLayerMaxImages);
      assert.equal(keyFrame.seedreamLayerTextRecognition, seedreamLayerTextRecognition);
      assert.equal('seedreamBackground' in keyFrame, false);
    }
  }
}
assert.deepEqual(seedreamKeys(layerRequest({ seedreamLayerMaxImages: 30 })), [
  'seedreamLayerDecomposition',
  'seedreamLayerMaxImages'
]);
assert.deepEqual(seedreamKeys(layerRequest({ seedreamLayerTextRecognition: true })), [
  'seedreamLayerDecomposition',
  'seedreamLayerTextRecognition'
]);
for (const seedreamLayerMaxImages of [0, 1, 101, 2.5, '17', null, Number.NaN]) {
  assert.throws(
    () => layerRequest({ seedreamLayerMaxImages }),
    /seedreamLayerMaxImages must be an integer from 2 to 100/,
    String(seedreamLayerMaxImages)
  );
}
for (const seedreamLayerTextRecognition of ['true', 1, null]) {
  assert.throws(
    () => layerRequest({ seedreamLayerTextRecognition }),
    /seedreamLayerTextRecognition must be a boolean/,
    String(seedreamLayerTextRecognition)
  );
}
// Both options configure a decomposition, so they need one.
for (const seedreamLayerDecomposition of [undefined, false]) {
  assert.throws(
    () =>
      request({
        contextImages: ['poster'],
        seedreamLayerDecomposition,
        seedreamLayerMaxImages: 17
      }),
    /seedreamLayerMaxImages requires seedreamLayerDecomposition/
  );
  assert.throws(
    () =>
      request({
        contextImages: ['poster'],
        seedreamLayerDecomposition,
        seedreamLayerTextRecognition: false
      }),
    /seedreamLayerTextRecognition requires seedreamLayerDecomposition/
  );
}
assert.throws(
  () => keyFrameOf({ seedreamLayerDecomposition: true }),
  /exactly one reference image/
);
assert.throws(
  () => keyFrameOf({ seedreamLayerDecomposition: true, contextImages: ['a', 'b'] }),
  /exactly one reference image/
);
assert.throws(
  () => keyFrameOf({ seedreamLayerDecomposition: true, contextImages: ['a'], numberOfMedia: 2 }),
  /set numberOfMedia to 1/
);
// 5.0 Pro decomposes too, but takes none of 5.5's options.
assert.deepEqual(
  seedreamKeys(
    keyFrameOf(
      { contextImages: ['poster'], seedreamLayerDecomposition: true, seedreamLayerSize: '2K' },
      SEEDREAM_PRO
    )
  ),
  ['seedreamLayerDecomposition', 'seedreamLayerSize']
);
for (const option of [
  { seedreamLayerMaxImages: 17 },
  { seedreamLayerTextRecognition: true },
  { seedreamBackground: 'transparent' }
]) {
  assert.throws(
    () =>
      keyFrameOf(
        { contextImages: ['poster'], seedreamLayerDecomposition: true, ...option },
        SEEDREAM_PRO
      ),
    /requires seedream-5-5-uncensored/,
    JSON.stringify(option)
  );
}

// Layer results: zIndex 1-99, with optional camelCased text recognition.
const box = (left, top, right, bottom) => ({
  absolute: [left, top, right, bottom],
  normalized: [0, 0, 500, 500]
});
const style = (extra = {}) => ({
  similarFontFamily: 'Helvetica Neue',
  foregroundColor: '#FFCC00',
  bold: true,
  italic: false,
  underline: false,
  strikethrough: false,
  shadow: true,
  translucent: false,
  ...extra
});
const recognition = () => ({
  text: 'GRAND OPENING\nFriday 8 PM',
  lines: [
    { boundingBox: box(100, 80, 900, 160), runs: [{ text: 'GRAND OPENING', style: style() }] },
    {
      boundingBox: box(100, 180, 700, 230),
      runs: [
        { text: 'Friday ', style: style({ bold: false, shadow: false }) },
        { text: '8 PM', style: style({ foregroundColor: '#FFFFFF' }) }
      ]
    }
  ]
});
const layer = (zIndex, extra = {}) => ({
  url: `https://cdn.sogni.ai/layer-${zIndex}.png`,
  key: `vendor/bytedance/seedream-5-5-uncensored/2026-11-13/job.layer-${zIndex}.png`,
  width: 1429,
  height: 1652,
  zIndex,
  boundingBox: box(10, 20, 719, 840),
  name: `Layer ${zIndex}`,
  description: `Layer ${zIndex} description`,
  ...extra
});
const publicLayer = (raw) => {
  const { key, ...rest } = raw;
  return rest;
};
{
  const text = layer(3, { textRecognition: recognition() });
  const parsed = imageLayersFromResult([layer(99), text, layer(1)]);
  assert.deepEqual(parsed, [publicLayer(layer(1)), publicLayer(text), publicLayer(layer(99))]);
  assert.deepEqual(parsed[1].textRecognition, recognition());
  // Layers without text recognition (the usual case) carry no such field.
  assert.equal('textRecognition' in parsed[0], false);
  // zIndex 0 is the base and 100 is beyond the 99 layers Seedream returns.
  assert.deepEqual(imageLayersFromResult([layer(0), layer(100), layer(2)]), [
    publicLayer(layer(2))
  ]);
  assert.equal(imageLayersFromResult([layer(100)]), undefined);
  // A malformed recognition is left out whole; the layer itself is kept.
  const broken = [
    null,
    'GRAND OPENING',
    { text: 'GRAND OPENING' },
    { lines: [] },
    { ...recognition(), text: 7 },
    { ...recognition(), lines: [{ boundingBox: box(0, 0, 1, 1) }] },
    { ...recognition(), lines: [{ runs: [{ text: 'x', style: style() }] }] },
    { ...recognition(), lines: [{ boundingBox: { absolute: [0, 0, 1] }, runs: [] }] },
    { ...recognition(), lines: [{ boundingBox: box(0, 0, 1, 1), runs: [{ text: 'x' }] }] },
    { ...recognition(), lines: [{ boundingBox: box(0, 0, 1, 1), runs: [{ style: style() }] }] },
    {
      ...recognition(),
      lines: [
        { boundingBox: box(0, 0, 1, 1), runs: [{ text: 'x', style: style({ bold: 'yes' }) }] }
      ]
    },
    {
      ...recognition(),
      lines: [
        {
          boundingBox: box(0, 0, 1, 1),
          runs: [{ text: 'x', style: style({ foregroundColor: 0 }) }]
        }
      ]
    },
    {
      ...recognition(),
      lines: [
        ...recognition().lines,
        {
          boundingBox: box(0, 0, 1, 1),
          runs: [{ text: 'x', style: { similarFontFamily: 'unknown' } }]
        }
      ]
    },
    // The vendor's snake_case shape is the API's to camelCase, not the SDK's.
    { text: 'x', lines: [{ bounding_box: box(0, 0, 1, 1), runs: [] }] }
  ];
  for (const textRecognition of broken) {
    const [parsedLayer] = imageLayersFromResult([layer(4, { textRecognition })]);
    assert.equal(parsedLayer.zIndex, 4);
    assert.equal('textRecognition' in parsedLayer, false, JSON.stringify(textRecognition));
  }
  // An empty recognition is still well formed.
  assert.deepEqual(
    imageLayersFromResult([layer(5, { textRecognition: { text: '', lines: [] } })])[0]
      .textRecognition,
    {
      text: '',
      lines: []
    }
  );
}

// A 5.5 decomposition end to end: the jobResult's layers land on the Job and
// its completed event, getLayerUrl refreshes any of the 99, and the quote
// asks for the image ceiling the request set.
async function checkLayerResults() {
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
    modelId: SEEDREAM_55,
    positivePrompt: '',
    numberOfMedia: 1,
    contextImages: [true],
    seedreamLayerDecomposition: true,
    seedreamLayerSize: '1.5K',
    seedreamLayerMaxImages: 100,
    seedreamLayerTextRecognition: true
  });
  client.socket.emit('jobState', {
    type: 'jobStarted',
    jobID: project.id,
    imgID: 'seedream-55-layers',
    workerName: ''
  });
  const textLayer = layer(2, { textRecognition: recognition() });
  client.socket.emit('jobResult', {
    jobID: project.id,
    imgID: 'seedream-55-layers',
    resultUrl: 'https://cdn.sogni.ai/base.png',
    outputFormat: 'png',
    performedStepCount: 1,
    lastSeed: '-1',
    triggeredNSFWFilter: false,
    userCanceled: false,
    layers: [layer(99), textLayer, layer(1)]
  });
  await new Promise((resolve) => setImmediate(resolve));
  const job = project.job('seedream-55-layers');
  const expected = [publicLayer(layer(1)), publicLayer(textLayer), publicLayer(layer(99))];
  assert.equal(job.resultUrl, 'https://cdn.sogni.ai/base.png');
  assert.deepEqual(job.layers, expected);
  assert.deepEqual(job.layers[1].textRecognition.lines[1].runs[1].style.foregroundColor, '#FFFFFF');
  assert.equal(completedEvents.length, 1);
  assert.deepEqual(completedEvents[0].layers, expected);

  const downloads = [];
  projects.downloadUrl = async (params) => {
    downloads.push(params);
    return `https://cdn.sogni.ai/fresh-layer-${params.layerIndex}.png`;
  };
  assert.equal(await job.getLayerUrl(99), 'https://cdn.sogni.ai/fresh-layer-99.png');
  assert.equal(await job.getLayerUrl(1), 'https://cdn.sogni.ai/fresh-layer-1.png');
  assert.deepEqual(downloads, [
    { jobId: project.id, imageId: job.id, type: 'complete', layerIndex: 99 },
    { jobId: project.id, imageId: job.id, type: 'complete', layerIndex: 1 }
  ]);
  for (const missing of [0, 3, 100]) {
    await assert.rejects(job.getLayerUrl(missing), /Layer is not available/, String(missing));
  }
  assert.equal(downloads.length, 2);

  // A REST sync of the finished job reads the same layers from its stored result.
  job._update({ layers: undefined });
  await job._syncWithRestData({
    imgID: 'seedream-55-layers',
    status: 'jobCompleted',
    performedSteps: 1,
    worker: {},
    resultUrl: 'https://cdn.sogni.ai/base.png',
    result: { layers: [textLayer, layer(1)] }
  });
  assert.deepEqual(job.layers, [publicLayer(layer(1)), publicLayer(textLayer)]);

  // Quotes: the ceiling rides beside the decomposition flag; the background
  // and text recognition do not change the price and are not sent.
  const estimatePaths = [];
  client.socket.get = async (path) => {
    estimatePaths.push(path);
    return {
      quote: { project: { costInToken: '1', costInUSD: '1', costInSpark: '1', costInSogni: '1' } }
    };
  };
  const base = {
    model: SEEDREAM_55,
    imageCount: 1,
    stepCount: 1,
    previewCount: 0,
    width: 1536,
    height: 1536
  };
  await projects.estimateCost({ ...base, seedreamBackground: 'transparent' });
  await projects.estimateCost({ ...base, contextImages: 1, seedreamLayerDecomposition: true });
  await projects.estimateCost({
    ...base,
    contextImages: 1,
    seedreamLayerDecomposition: true,
    seedreamLayerSize: '2K',
    seedreamLayerMaxImages: 100,
    seedreamLayerTextRecognition: true
  });
  assert.deepEqual(estimatePaths, [
    '/api/v2/job/estimate/spark/fast/seedream-5-5-uncensored/1/1/0/0/0/1536/1536',
    '/api/v3/job/estimate/spark/fast/seedream-5-5-uncensored/1/1/0/0/0/1536/1536/0/_/1?seedreamLayerDecomposition=true',
    '/api/v3/job/estimate/spark/fast/seedream-5-5-uncensored/1/1/0/0/0/1536/1536/0/_/1' +
      '?seedreamLayerDecomposition=true&seedreamLayerSize=2K&seedreamLayerMaxImages=100'
  ]);

  // A 5.5 transparent request reaches the socket with its background.
  const sent = [];
  client.socket.send = async (type, payload) => {
    sent.push({ type, payload });
  };
  const transparent = await projects.create({
    type: 'image',
    modelId: SEEDREAM_55,
    positivePrompt: 'A glossy cherry sticker',
    numberOfMedia: 1,
    sizePreset: 'custom',
    width: 1536,
    height: 1536,
    seedreamBackground: 'transparent'
  });
  const jobRequest = sent.find((entry) => entry.type === 'jobRequest');
  assert.equal(jobRequest.payload.keyFrames[0].seedreamBackground, 'transparent');
  assert.deepEqual(seedreamKeys(jobRequest.payload.keyFrames[0]), ['seedreamBackground']);

  for (const finished of [project, transparent]) {
    finished._update({ status: 'failed', error: { code: 0, message: 'test cleanup' } });
  }
}

checkLayerResults()
  .then(() =>
    console.log(
      'Seedream 5.5 Uncensored identity, selectors, sizes, references, backgrounds, layers and quotes passed'
    )
  )
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
