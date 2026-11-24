'use strict';
const assert = require('node:assert/strict');
const create = require('../dist/Projects/createJobRequestMessage.js').default;
const {
  isVideoModel,
  SAM3_VIDEO_SEGMENT_MODEL_ID,
  calculateVideoFrames
} = require('../dist/Projects/utils/index.js');
const options = {
  type: 'video',
  steps: { min: 1, max: 1, default: 1 },
  guidance: { min: 1, max: 1, default: 1 },
  sampler: { allowed: [], default: null },
  scheduler: { allowed: [], default: null }
};
const params = {
  type: 'video',
  modelId: SAM3_VIDEO_SEGMENT_MODEL_ID,
  positivePrompt: '',
  numberOfMedia: 1,
  referenceVideo: true,
  sam3VideoPrompt: { text: 'unicorn horn', frameIndex: 126 },
  width: 1920,
  height: 1080,
  frames: 255,
  fps: 24
};
assert(isVideoModel(params.modelId));
assert.equal(calculateVideoFrames(params.modelId, 300 / (30000 / 1001), 30000 / 1001), 300);
const request = create('selection-wire', params, options);
assert.equal(request.outputFormat, 'mp4');
assert.equal(request.keyFrames[0].frames, 255);
assert.equal(request.keyFrames[0].sam3VideoPrompt.frameIndex, 126);
assert.equal(request.keyFrames[0].hasReferenceVideo, true);
assert.equal(request.keyFrames[0].interpolation, 'none');
for (const overrides of [
  { numberOfMedia: 2 },
  { referenceVideo: undefined },
  { sam3VideoPrompt: { text: 'horn', frameIndex: 255 } },
  { sam3VideoPrompt: { text: 'horn', applyMask: true } },
  { sam3VideoPrompt: { text: 'horn', maxInstances: 2 } },
  { positivePrompt: 'change the video' },
  { trimEndFrame: true }
]) {
  assert.throws(() => create('invalid-selection', { ...params, ...overrides }, options));
}
const fractional = create('fractional', { ...params, fps: 30000 / 1001 }, options);
const point = { x: 0.5, y: 0.5, label: 'positive' };
const box = { x0: 0, y0: 0, x1: 1, y1: 1 };
assert.throws(
  () =>
    create(
      'point-index',
      { ...params, sam3VideoPrompt: { points: [point], objectIndex: 1 } },
      options
    ),
  /objectIndex 0/
);
assert.throws(
  () =>
    create('box-index', { ...params, sam3VideoPrompt: { boxes: [box], objectIndex: 1 } }, options),
  /supplied box/
);
assert.equal(
  create(
    'second-box',
    { ...params, sam3VideoPrompt: { boxes: [box, box], objectIndex: 1 } },
    options
  ).keyFrames[0].sam3VideoPrompt.objectIndex,
  1
);
assert.equal(
  create(
    'second-text-instance',
    { ...params, sam3VideoPrompt: { text: 'lamp', objectIndex: 1 } },
    options
  ).keyFrames[0].sam3VideoPrompt.objectIndex,
  1
);
assert.equal(fractional.keyFrames[0].fps, 30000 / 1001);
const { width, height, frames, fps, ...withoutMetadata } = params;
const probed = create('probed-source', withoutMetadata, options);
for (const field of ['width', 'height', 'frames', 'fps'])
  assert.equal(probed.keyFrames[0][field], undefined);

// A prompt without the opt-in fields is sent byte for byte as before. These key
// frames were captured from 5.79.0 (c397d41) before the opt-in fields existed.
const OLD_KEY_FRAMES = [
  "{\"stepsIsEnabled\":true,\"siRotation\":0,\"siDragOffsetIsEnabled\":true,\"strength\":0.5,\"siZoomScaleIsEnabled\":true,\"isEnabled\":true,\"processing\":\"CPU, GPU\",\"useLastImageAsGuideImageInAnimation\":true,\"guidanceScaleIsEnabled\":true,\"siImageBackgroundColor\":\"black\",\"cnDragOffset\":[0,0],\"scheduler\":null,\"timeStepSpacing\":null,\"steps\":1,\"cnRotation\":0,\"siZoomScale\":1,\"modelID\":\"sam3_video_segment_fp16\",\"cnRotationIsEnabled\":true,\"negativePrompt\":\"\",\"startingImageZoomPanIsOn\":false,\"seed\":0,\"siRotationIsEnabled\":true,\"cnImageBackgroundColor\":\"clear\",\"strengthIsEnabled\":true,\"siDragOffset\":[0,0],\"useLastImageAsCNImageInAnimation\":false,\"positivePrompt\":\"\",\"controlNetZoomPanIsOn\":false,\"cnZoomScaleIsEnabled\":true,\"currentControlNets\":null,\"stylePrompt\":\"\",\"cnDragOffsetIsEnabled\":true,\"frameIndex\":0,\"startingImage\":null,\"cnZoomScale\":1,\"hasReferenceVideo\":true,\"sam3VideoPrompt\":{\"points\":[],\"boxes\":[],\"text\":\"unicorn horn\",\"threshold\":0.5,\"applyMask\":false,\"maxInstances\":1,\"frameIndex\":126,\"objectIndex\":0,\"output\":\"mask\",\"edges\":\"hard\"},\"interpolation\":\"none\",\"generateAudio\":false,\"width\":1920,\"height\":1080,\"frames\":255,\"fps\":24}",
  "{\"stepsIsEnabled\":true,\"siRotation\":0,\"siDragOffsetIsEnabled\":true,\"strength\":0.5,\"siZoomScaleIsEnabled\":true,\"isEnabled\":true,\"processing\":\"CPU, GPU\",\"useLastImageAsGuideImageInAnimation\":true,\"guidanceScaleIsEnabled\":true,\"siImageBackgroundColor\":\"black\",\"cnDragOffset\":[0,0],\"scheduler\":null,\"timeStepSpacing\":null,\"steps\":1,\"cnRotation\":0,\"siZoomScale\":1,\"modelID\":\"sam3_video_segment_fp16\",\"cnRotationIsEnabled\":true,\"negativePrompt\":\"\",\"startingImageZoomPanIsOn\":false,\"seed\":0,\"siRotationIsEnabled\":true,\"cnImageBackgroundColor\":\"clear\",\"strengthIsEnabled\":true,\"siDragOffset\":[0,0],\"useLastImageAsCNImageInAnimation\":false,\"positivePrompt\":\"\",\"controlNetZoomPanIsOn\":false,\"cnZoomScaleIsEnabled\":true,\"currentControlNets\":null,\"stylePrompt\":\"\",\"cnDragOffsetIsEnabled\":true,\"frameIndex\":0,\"startingImage\":null,\"cnZoomScale\":1,\"hasReferenceVideo\":true,\"sam3VideoPrompt\":{\"points\":[{\"x\":0.25,\"y\":0.75,\"label\":\"positive\"}],\"boxes\":[{\"x0\":0.1,\"y0\":0.2,\"x1\":0.6,\"y1\":0.9,\"label\":\"positive\"}],\"threshold\":0.5,\"multimask\":false,\"applyMask\":false,\"maxInstances\":1,\"frameIndex\":0,\"objectIndex\":0,\"output\":\"mask\",\"edges\":\"hard\"},\"interpolation\":\"none\",\"generateAudio\":false}",
  "{\"stepsIsEnabled\":true,\"siRotation\":0,\"siDragOffsetIsEnabled\":true,\"strength\":0.5,\"siZoomScaleIsEnabled\":true,\"isEnabled\":true,\"processing\":\"CPU, GPU\",\"useLastImageAsGuideImageInAnimation\":true,\"guidanceScaleIsEnabled\":true,\"siImageBackgroundColor\":\"black\",\"cnDragOffset\":[0,0],\"scheduler\":null,\"timeStepSpacing\":null,\"steps\":1,\"cnRotation\":0,\"siZoomScale\":1,\"modelID\":\"sam3_video_segment_fp16\",\"cnRotationIsEnabled\":true,\"negativePrompt\":\"\",\"startingImageZoomPanIsOn\":false,\"seed\":0,\"siRotationIsEnabled\":true,\"cnImageBackgroundColor\":\"clear\",\"strengthIsEnabled\":true,\"siDragOffset\":[0,0],\"useLastImageAsCNImageInAnimation\":false,\"positivePrompt\":\"\",\"controlNetZoomPanIsOn\":false,\"cnZoomScaleIsEnabled\":true,\"currentControlNets\":null,\"stylePrompt\":\"\",\"cnDragOffsetIsEnabled\":true,\"frameIndex\":0,\"startingImage\":null,\"cnZoomScale\":1,\"hasReferenceVideo\":true,\"sam3VideoPrompt\":{\"points\":[],\"boxes\":[{\"x0\":0,\"y0\":0,\"x1\":0.5,\"y1\":0.5,\"label\":\"positive\"},{\"x0\":0.5,\"y0\":0.5,\"x1\":1,\"y1\":1,\"label\":\"positive\"}],\"threshold\":0.3,\"applyMask\":false,\"maxInstances\":1,\"frameIndex\":0,\"objectIndex\":1,\"output\":\"mask\",\"edges\":\"hard\"},\"interpolation\":\"none\",\"generateAudio\":false,\"fps\":29.97002997002997}",
  "{\"stepsIsEnabled\":true,\"siRotation\":0,\"siDragOffsetIsEnabled\":true,\"strength\":0.5,\"siZoomScaleIsEnabled\":true,\"isEnabled\":true,\"processing\":\"CPU, GPU\",\"useLastImageAsGuideImageInAnimation\":true,\"guidanceScaleIsEnabled\":true,\"siImageBackgroundColor\":\"black\",\"cnDragOffset\":[0,0],\"scheduler\":null,\"timeStepSpacing\":null,\"steps\":1,\"cnRotation\":0,\"siZoomScale\":1,\"modelID\":\"sam3_video_segment_fp16\",\"cnRotationIsEnabled\":true,\"negativePrompt\":\"\",\"startingImageZoomPanIsOn\":false,\"seed\":0,\"siRotationIsEnabled\":true,\"cnImageBackgroundColor\":\"clear\",\"strengthIsEnabled\":true,\"siDragOffset\":[0,0],\"useLastImageAsCNImageInAnimation\":false,\"positivePrompt\":\"\",\"controlNetZoomPanIsOn\":false,\"cnZoomScaleIsEnabled\":true,\"currentControlNets\":null,\"stylePrompt\":\"\",\"cnDragOffsetIsEnabled\":true,\"frameIndex\":0,\"startingImage\":null,\"cnZoomScale\":1,\"hasReferenceVideo\":true,\"sam3VideoPrompt\":{\"points\":[],\"boxes\":[{\"x0\":0.1,\"y0\":0.2,\"x1\":0.4,\"y1\":0.8,\"label\":\"negative\"}],\"text\":\"horn\",\"threshold\":0.5,\"applyMask\":false,\"maxInstances\":1,\"frameIndex\":7,\"objectIndex\":0,\"output\":\"mask\",\"edges\":\"hard\"},\"interpolation\":\"none\",\"generateAudio\":false}"
];
const oldPrompts = [
  [{ text: 'unicorn horn', frameIndex: 126 }, { width: 1920, height: 1080, frames: 255, fps: 24 }],
  [{ points: [{ x: 0.25, y: 0.75, label: 'positive' }], boxes: [{ x0: 0.1, y0: 0.2, x1: 0.6, y1: 0.9 }], multimask: false }, {}],
  [{ boxes: [{ x0: 0, y0: 0, x1: 0.5, y1: 0.5 }, { x0: 0.5, y0: 0.5, x1: 1, y1: 1 }], objectIndex: 1, threshold: 0.3 }, { fps: 30000 / 1001 }],
  [{ text: 'horn', boxes: [{ x0: 0.1, y0: 0.2, x1: 0.4, y1: 0.8, label: 'negative' }], frameIndex: 7 }, {}],
];
const { width: _w, height: _h, frames: _f, fps: _fps, sam3VideoPrompt: _p, ...base } = params;
oldPrompts.forEach(([sam3VideoPrompt, extra], index) => {
  assert.equal(JSON.stringify(create('selection-wire', { ...base, ...extra, sam3VideoPrompt }, options).keyFrames[0]), OLD_KEY_FRAMES[index]);
});

// The opt-in fields (mask, objects + combine, frames, memory) reach the server unchanged.
const square = [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]];
const optInPrompts = [
  { mask: { polygons: [square, [[0.4, 0.4], [0.6, 0.4], [0.5, 0.6]]] }, frameIndex: 4 },
  { objects: [{ text: 'monitor' }, { points: [{ x: 0.5, y: 0.5, label: 'positive' }], multimask: false }, { mask: { polygons: [square] }, objectIndex: 0 }], combine: 'union', frameIndex: 12 },
  { frames: [{ frameIndex: 0, text: 'horn' }, { frameIndex: 254, boxes: [{ x0: 0.1, y0: 0.1, x1: 0.5, y1: 0.5 }], objectIndex: 0 }] },
  { text: 'horn', frameIndex: 9, memory: 'anchor' },
  { objects: [{ text: 'a' }, { text: 'b' }], combine: 'union', memory: 'chunk' },
];
for (const sam3VideoPrompt of optInPrompts) {
  const sent = JSON.parse(JSON.stringify(sam3VideoPrompt));
  const keyFrame = create('opt-in', { ...params, sam3VideoPrompt }, options).keyFrames[0];
  assert.deepEqual(keyFrame.sam3VideoPrompt, sent);
  assert.equal(JSON.stringify(keyFrame.sam3VideoPrompt), JSON.stringify(sent));
  assert.deepEqual(sam3VideoPrompt, sent, 'the caller prompt is not modified');
  assert.equal(keyFrame.frames, 255);
  assert.equal(keyFrame.hasReferenceVideo, true);
  assert.equal(keyFrame.steps, 1);
  assert.equal(keyFrame.interpolation, 'none');
  for (const overrides of [{ numberOfMedia: 2 }, { referenceVideo: undefined }, { positivePrompt: 'change the video' }, { frames: 0 }]) {
    assert.throws(() => create('invalid-opt-in', { ...params, sam3VideoPrompt, ...overrides }, options));
  }
}
console.log('SAM 3 video wire, validation and exact timing checks passed');

async function checkProjectUploadAndReceipt() {
  const { EventEmitter } = require('node:events');
  const ProjectsApi = require('../dist/Projects/index.js').default;
  const socket = Object.assign(new EventEmitter(), {
    send: async (type, request) => sent.push({ type, request })
  });
  const sent = [];
  const uploads = [];
  const client = Object.assign(new EventEmitter(), {
    socket,
    rest: {},
    appSource: 'sam3-contract-test',
    logger: { debug() {}, info() {}, warn() {}, error() {} }
  });
  const api = new ProjectsApi({ client, eip712: {} });
  api.getModelOptions = async () => options;
  api._assets = {
    tryBindFile: async (file, contentType, binding) => {
      uploads.push({ file, contentType, binding });
      return true;
    }
  };
  const source = new Blob(['exact uploaded source bytes'], { type: 'video/mp4' });
  try {
    const project = await api.create({ ...withoutMetadata, referenceVideo: source });
    assert.equal(uploads.length, 1);
    assert.equal(uploads[0].file, source);
    assert.equal(uploads[0].binding.type, 'referenceVideo');
    assert.equal(uploads[0].binding.projectId, project.id);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].type, 'jobRequest');
    assert.equal(sent[0].request.keyFrames[0].referenceVideoContentType, 'video/mp4');
    assert.equal(sent[0].request.keyFrames[0].frames, undefined);
    const receipt = {
      sha256: 'a'.repeat(64),
      sourceVideoSha256: 'b'.repeat(64),
      samPromptSha256: 'c'.repeat(64),
      maskWidth: 1920,
      maskHeight: 1080,
      maskFrames: 255,
      maskFps: 24,
      samVersion: 'sam3.1@203579918+fp16@9ba99c92'
    };
    socket.emit('jobResult', {
      jobID: project.id,
      imgID: 'MASK-1',
      performedStepCount: 1,
      lastSeed: '0',
      triggeredNSFWFilter: false,
      userCanceled: false,
      ...receipt
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(project.job('MASK-1').provenance, receipt);
    project._dispose();
  } finally {
    for (const project of api.trackedProjects) project._dispose();
  }
  console.log('SAM 3 video source upload and completion receipt checks passed');
}
checkProjectUploadAndReceipt().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
