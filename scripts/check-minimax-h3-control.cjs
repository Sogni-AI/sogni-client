'use strict';
const assert = require('node:assert/strict');
const create = require('../dist/Projects/createJobRequestMessage.js').default;
const ProjectsApi = require('../dist/Projects/index.js').default;
const {
  getMinimaxH3ControlUploads,
  MINIMAX_H3_CONTROL_TYPES,
  MINIMAX_H3_CONTROL_MODEL_ID: modelId
} = require('../dist/Projects/minimaxH3Control.js');
const {
  getVideoAssetRequirements,
  getVideoWorkflowType,
  isMinimaxH3KeyframeModel,
  isMinimaxH3Model,
  isVideoModel
} = require('../dist/Projects/utils/index.js');
const baseline = require('./fixtures/ltx-v2v-control-baseline-5.81.0.json');

const image = new Blob(['mask'], { type: 'image/png' });
const video = new Blob(['video'], { type: 'video/mp4' });
const options = {
  type: 'video',
  sampler: { allowed: ['euler'], default: 'euler' },
  scheduler: { allowed: ['simple'], default: 'simple' }
};
const params = {
  type: 'video',
  modelId,
  positivePrompt: 'A person walking.',
  numberOfMedia: 1,
  width: 1344,
  height: 768,
  frames: 124,
  steps: 40,
  guidance: 1,
  referenceVideo: video
};
const frame = (changes) => create('h3-control', { ...params, ...changes }, options).keyFrames[0];

// The control model is an H3 v2v model with its own asset rules.
assert.equal(getVideoWorkflowType(modelId), 'v2v');
assert.equal(isMinimaxH3Model(modelId), true);
assert.equal(isVideoModel(modelId), true);
assert.equal(isMinimaxH3KeyframeModel(modelId), false);
assert.equal(getVideoAssetRequirements(modelId).referenceVideo, 'optional');
assert.equal(getVideoAssetRequirements(modelId).referenceAudioIdentity, 'forbidden');

// Without controlNet nothing is sent; the server runs depth.
assert.equal('currentControlNetsJob' in frame({}), false);
assert.equal(frame({}).fps, 24);
for (const strength of [0, 0.5, 1]) {
  assert.deepEqual(frame({ controlNet: { name: 'depth', strength } }).currentControlNetsJob, [
    { name: 'depth', controlStrength: strength }
  ]);
}
for (const name of MINIMAX_H3_CONTROL_TYPES) {
  const f = frame({
    controlNet: { name, strength: 0.8, preprocess: false, guidanceStart: 0.1, guidanceEnd: 0.9 },
    ...(name === 'inpaint' ? { referenceMask: image } : {})
  });
  assert.equal(f.modelID, modelId);
  assert.equal(f.hasReferenceVideo, true);
  assert.equal(f.hasReferenceMask, name === 'inpaint' ? true : undefined);
  assert.equal(f.steps, 40);
  assert.deepEqual(f.currentControlNetsJob, [
    {
      name,
      controlStrength: 0.8,
      preprocess: false,
      controlGuidanceStart: 0.1,
      controlGuidanceEnd: 0.9
    }
  ]);
}
// Six guide types at launch; a prepared controlVideo works with extraction off.
assert.deepEqual(
  [...MINIMAX_H3_CONTROL_TYPES],
  ['canny', 'depth', 'pose', 'hed', 'mlsd', 'inpaint']
);
for (const name of ['canny', 'depth', 'pose', 'hed', 'mlsd']) {
  const f = frame({ controlVideo: video, controlNet: { name, preprocess: false } });
  assert.equal(f.hasReferenceVideo3, true);
  assert.deepEqual(f.currentControlNetsJob, [{ name, preprocess: false }]);
}
// A mask can accompany a structural guide.
assert.equal(frame({ controlNet: { name: 'pose' }, referenceMask: image }).hasReferenceMask, true);
const combined = frame({ referenceMaskVideo: video, controlVideo: video, referenceImage: image });
assert.equal(combined.hasReferenceVideo2, true);
assert.equal(combined.hasReferenceVideo3, true);
assert.equal(combined.hasReferenceImage, true);
assert.equal(combined.hasReferenceMask, undefined);
const preparedOnly = frame({ referenceVideo: undefined, controlVideo: video });
assert.equal(preparedOnly.hasReferenceVideo3, true);
assert.equal(preparedOnly.hasReferenceVideo, undefined);
assert.deepEqual(
  getMinimaxH3ControlUploads({ referenceMaskVideo: video, controlVideo: video }).map((x) => x.id),
  ['referenceVideo2', 'referenceVideo3']
);

// Requests the Socket or the worker would refuse fail before anything uploads.
for (const changes of [
  { referenceVideo: undefined },
  { controlNet: { name: 'inpaint' } },
  { controlNet: { name: 'detailer' } },
  { controlNet: { name: 'outpaint' } },
  { referenceMask: image, referenceMaskVideo: video },
  { referenceVideo: undefined, controlVideo: video, referenceMask: image },
  { referenceVideo: undefined, controlVideo: video, referenceMaskVideo: video },
  { controlVideo: video, controlNet: { name: 'pose', preprocess: true } },
  { referenceMask: image, controlNet: { name: 'inpaint', preprocess: true } },
  { controlVideo: video, controlNet: { name: 'scribble', preprocess: false } },
  { controlVideo: video, controlNet: { name: 'layout', preprocess: false } },
  { controlVideo: video, controlNet: { name: 'gray', preprocess: false } },
  { controlNet: { name: 'depth', preprocess: 'yes' } },
  { controlNet: { name: 'depth', guidanceStart: 0.9, guidanceEnd: 0.1 } },
  { controlNet: { name: 'depth', guidanceStart: '0.1' } },
  { controlNet: { name: 'depth', guidanceEnd: 2 } },
  { controlNet: { name: 'depth', strength: NaN } },
  { controlNet: { name: 'depth', strength: 1.01 } },
  { controlNet: { name: 'depth', strength: 4 } },
  { controlNet: { name: 'depth', strength: -0.1 } },
  { referenceVideos: [video] },
  { referenceAudios: [video] },
  { referenceAudio: video },
  { referenceAudioIdentity: video },
  { referenceImageEnd: image },
  { contextImages: [image] },
  { referenceVideoUrls: ['https://example.com/a.mp4'] },
  { keyframes: [{ frameIndex: 40, image }] },
  { steps: 20 },
  { guidance: 2 },
  { negativePrompt: 'blur' },
  { frames: 244 },
  { fps: 30 }
]) {
  assert.throws(() => frame(changes), undefined, JSON.stringify(Object.keys(changes)));
}

// LTX 2.5/2.3 v2v requests are byte-identical to SDK 5.81.0, with or without the
// MiniMax H3 Control-only fields. At runtime LTX passes any controlNet name through,
// as 5.81.0 did, including names it has no workflow for.
const withExtras = (request) => ({
  ...request,
  referenceMaskVideo: baseline.extras.referenceMaskVideo,
  controlVideo: baseline.extras.controlVideo,
  ...(request.controlNet
    ? { controlNet: { ...request.controlNet, ...baseline.extras.controlNet } }
    : {})
});
for (const [name, { params: request, message }] of Object.entries(baseline.requests)) {
  const expected = JSON.stringify(message);
  const id = `baseline-${name}`;
  assert.equal(
    JSON.stringify(create(id, request, baseline.options)),
    expected,
    `${name} unchanged`
  );
  assert.equal(
    JSON.stringify(create(id, withExtras(request), baseline.options)),
    expected,
    `${name} ignores the MiniMax H3 Control-only fields`
  );
}
const ltx = baseline.requests['ltx25-depth'].params;
for (const name of ['hed', 'mlsd', 'scribble', 'layout', 'gray']) {
  assert.deepEqual(
    create('ltx-name', { ...ltx, controlNet: { name } }, baseline.options).keyFrames[0]
      .currentControlNetsJob,
    [{ name }]
  );
}
assert.throws(
  () => create('ltx-strength', { ...ltx, controlNet: { name: 'depth', strength: 2.5 } }, options),
  /strength must be less or equal 1/
);

async function checkUploads() {
  const uploads = [];
  const target = {
    uploadReferenceVideo: async (...args) => uploads.push(args),
    uploadReferenceMask: async (...args) => uploads.push(['mask', ...args])
  };
  const processAssets = (data) =>
    ProjectsApi.prototype._processVideoAssets.call(target, { id: 'project' }, data);
  await processAssets({ ...params, referenceMaskVideo: video, controlVideo: video });
  assert.deepEqual(uploads, [
    ['project', video],
    ['project', video, 'referenceVideo2'],
    ['project', video, 'referenceVideo3']
  ]);
  uploads.length = 0;
  await processAssets({
    ...params,
    referenceVideo: true,
    referenceMask: image,
    controlVideo: true
  });
  assert.deepEqual(
    uploads,
    [['mask', 'project', image]],
    'already uploaded video roles stay attached without another upload'
  );

  // LTX uploads only what it uploaded before: the source, plus the mask for inpaint.
  const maskVideo = new Blob(['mask-video'], { type: 'video/mp4' });
  const controlVideo = new Blob(['control'], { type: 'video/mp4' });
  const ltxUpload = {
    type: 'video',
    modelId: 'ltx25-22b-int8_v2v_distilled',
    referenceVideo: video
  };
  const extraMedia = { referenceMaskVideo: maskVideo, controlVideo };
  uploads.length = 0;
  await processAssets({
    ...ltxUpload,
    ...extraMedia,
    controlNet: { name: 'depth', preprocess: false }
  });
  assert.deepEqual(uploads, [['project', video]]);
  uploads.length = 0;
  await processAssets({
    ...ltxUpload,
    ...extraMedia,
    referenceMask: image,
    controlNet: { name: 'inpaint' }
  });
  assert.deepEqual(uploads, [
    ['project', video],
    ['mask', 'project', image]
  ]);
  console.log(
    `MiniMax H3 Control SDK: ${MINIMAX_H3_CONTROL_TYPES.length} control types, uploads and refusals passed; ` +
      `${Object.keys(baseline.requests).length} LTX v2v requests match SDK 5.81.0 with and without the new fields`
  );
}
checkUploads().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
