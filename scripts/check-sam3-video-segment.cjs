'use strict';
const assert = require('node:assert/strict');
const create = require('../dist/Projects/createJobRequestMessage.js').default;
const { isVideoModel, SAM3_VIDEO_SEGMENT_MODEL_ID, calculateVideoFrames } = require('../dist/Projects/utils/index.js');
const options = { type: 'video', steps: { min: 1, max: 1, default: 1 }, guidance: { min: 1, max: 1, default: 1 }, sampler: { allowed: [], default: null }, scheduler: { allowed: [], default: null } };
const params = { type: 'video', modelId: SAM3_VIDEO_SEGMENT_MODEL_ID, positivePrompt: '', numberOfMedia: 1, referenceVideo: true, sam3VideoPrompt: { text: 'unicorn horn', frameIndex: 126 }, width: 1920, height: 1080, frames: 255, fps: 24 };
assert(isVideoModel(params.modelId));
assert.equal(calculateVideoFrames(params.modelId, 300 / (30000 / 1001), 30000 / 1001), 300);
const request = create('selection-wire', params, options);
assert.equal(request.outputFormat, 'mp4');
assert.equal(request.keyFrames[0].frames, 255);
assert.equal(request.keyFrames[0].sam3VideoPrompt.frameIndex, 126);
assert.equal(request.keyFrames[0].hasReferenceVideo, true);
assert.equal(request.keyFrames[0].interpolation, 'none');
for (const overrides of [{ numberOfMedia: 2 }, { referenceVideo: undefined }, { sam3VideoPrompt: { text: 'horn', frameIndex: 255 } }, { sam3VideoPrompt: { text: 'horn', applyMask: true } }, { sam3VideoPrompt: { text: 'horn', maxInstances: 2 } }, { positivePrompt: 'change the video' }, { trimEndFrame: true }]) {
  assert.throws(() => create('invalid-selection', { ...params, ...overrides }, options));
}
const fractional = create('fractional', { ...params, fps: 30000 / 1001 }, options);
assert.equal(fractional.keyFrames[0].fps, 30000 / 1001);
const { width, height, frames, fps, ...withoutMetadata } = params;
const probed = create('probed-source', withoutMetadata, options);
for (const field of ['width', 'height', 'frames', 'fps']) assert.equal(probed.keyFrames[0][field], undefined);
console.log('SAM 3 video wire, validation and exact timing checks passed');

async function checkProjectUploadAndReceipt() {
  const { EventEmitter } = require('node:events');
  const ProjectsApi = require('../dist/Projects/index.js').default;
  const socket = Object.assign(new EventEmitter(), { send: async (type, request) => sent.push({ type, request }) });
  const sent = [];
  const uploads = [];
  const client = Object.assign(new EventEmitter(), { socket, rest: {}, appSource: 'sam3-contract-test',
    logger: { debug() {}, info() {}, warn() {}, error() {} } });
  const api = new ProjectsApi({ client, eip712: {} });
  api.getModelOptions = async () => options;
  api._assets = { tryBindFile: async (file, contentType, binding) => { uploads.push({ file, contentType, binding }); return true; } };
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
    const receipt = { sha256: 'a'.repeat(64), sourceVideoSha256: 'b'.repeat(64), samPromptSha256: 'c'.repeat(64),
      maskWidth: 1920, maskHeight: 1080, maskFrames: 255, maskFps: 24, samVersion: 'sam3.1@203579918+fp16@9ba99c92' };
    socket.emit('jobResult', { jobID: project.id, imgID: 'MASK-1', performedStepCount: 1, lastSeed: '0',
      triggeredNSFWFilter: false, userCanceled: false, ...receipt });
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.deepEqual(project.job('MASK-1').provenance, receipt);
    project._dispose();
  } finally {
    for (const project of api.trackedProjects) project._dispose();
  }
  console.log('SAM 3 video source upload and completion receipt checks passed');
}
checkProjectUploadAndReceipt().catch(error => { console.error(error); process.exitCode = 1; });
