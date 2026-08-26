'use strict';

const assert = require('node:assert/strict');
const createJobRequestMessage = require('../dist/Projects/createJobRequestMessage.js').default;
const {
  isExternalApiVideoModel,
  isVideoModel,
  isWan3Model
} = require('../dist/Projects/utils/index.js');
const {
  animatePhotoTool,
  generateVideoTool,
  soundToVideoTool,
  videoToVideoTool
} = require('../dist/Chat/tools.js');

const MODEL_ID = 'wan3.0-video';
const VIDEO_OPTIONS = {
  type: 'video',
  width: { min: 480, max: 1920, step: 8, default: 1920 },
  height: { min: 480, max: 1920, step: 8, default: 1080 },
  sampler: { allowed: [], default: null },
  scheduler: { allowed: [], default: null }
};

function request(overrides = {}) {
  return createJobRequestMessage(
    '00000000-0000-4000-8000-000000000003',
    {
      type: 'video',
      modelId: MODEL_ID,
      positivePrompt: 'A detailed cinematic shot with natural dialogue.',
      numberOfMedia: 1,
      duration: 5,
      width: 1920,
      height: 1080,
      ...overrides
    },
    VIDEO_OPTIONS
  );
}

function urls(prefix, count, extension) {
  return Array.from(
    { length: count },
    (_, index) => `https://cdn.example.com/${prefix}-${index + 1}.${extension}`
  );
}

assert.equal(isWan3Model(MODEL_ID), true);
assert.equal(isVideoModel(MODEL_ID), true);
assert.equal(isExternalApiVideoModel(MODEL_ID), true);

for (const tool of [generateVideoTool, animatePhotoTool, soundToVideoTool]) {
  assert.ok(
    tool.function.parameters.properties.videoModel.enum.includes(MODEL_ID),
    `${tool.function.name} does not expose ${MODEL_ID}`
  );
}
assert.equal(
  videoToVideoTool.function.parameters.properties.videoModel.enum.includes(MODEL_ID),
  false,
  'Wan 3 must not be exposed as a source-video editing model'
);

const text = request();
assert.equal(text.keyFrames[0].fps, 30);
assert.equal(text.keyFrames[0].frames, 151);

const completeOptions = request({
  duration: undefined,
  smartDuration: true,
  ratio: 'adaptive',
  promptExtend: false,
  watermark: true,
  referenceFileUrl: 'https://cdn.example.com/brief.pdf'
});
assert.equal(completeOptions.keyFrames[0].smartDuration, true);
assert.equal(completeOptions.keyFrames[0].frames, 901);
assert.equal(completeOptions.keyFrames[0].ratio, 'adaptive');
assert.equal(completeOptions.keyFrames[0].promptExtend, false);
assert.equal(completeOptions.keyFrames[0].watermark, true);
assert.equal(completeOptions.keyFrames[0].referenceFileURL, 'https://cdn.example.com/brief.pdf');

const firstAndLast = request({
  referenceImage: new Blob(['first'], { type: 'image/png' }),
  referenceImageEnd: new Blob(['last'], { type: 'image/png' })
});
assert.equal(firstAndLast.keyFrames[0].hasReferenceImage, true);
assert.equal(firstAndLast.keyFrames[0].hasReferenceImageEnd, true);

const references = request({
  referenceImageUrls: urls('image', 10, 'jpg'),
  referenceVideoUrls: urls('video', 5, 'mp4'),
  referenceAudioUrls: urls('audio', 5, 'mp3')
});
assert.equal(references.keyFrames[0].referenceImageURLs.length, 10);
assert.equal(references.keyFrames[0].referenceVideoURLs.length, 5);
assert.equal(references.keyFrames[0].referenceAudioURLs.length, 5);

assert.throws(
  () => request({ referenceImageEnd: new Blob(['last'], { type: 'image/png' }) }),
  /requires a first-frame referenceImage/
);
assert.throws(
  () =>
    request({
      referenceImage: new Blob(['first'], { type: 'image/png' }),
      referenceVideoUrls: ['https://cdn.example.com/reference.mp4']
    }),
  /cannot be combined with loose/
);
assert.throws(
  () => request({ referenceImageUrls: urls('image', 11, 'jpg') }),
  /at most 10 reference images/
);
assert.throws(() => request({ duration: 31 }), /less or equal 30/);
assert.throws(() => request({ duration: 1 }), /greater or equal 2/);
assert.throws(() => request({ fps: 24 }), /fixed at 30 fps/);
assert.throws(() => request({ seed: 2_147_483_648 }), /0 through 2147483647/);
assert.throws(
  () =>
    request({
      referenceFileUrl: 'https://cdn.example.com/a.pdf',
      referenceLinkUrl: 'https://example.com'
    }),
  /either one reference file or one reference link/
);
const legacyTaskField = request({
  wan3TaskType: 'extend',
  referenceVideoUrls: ['https://cdn.example.com/v.mp4'],
  ratio: '16:9'
});
assert.equal(legacyTaskField.keyFrames[0].ratio, '16:9');
assert.equal(legacyTaskField.keyFrames[0].wan3TaskType, undefined);
assert.throws(() => request({ smartDuration: true }), /mutually exclusive/);

console.log('Wan 3 video transport checks passed');
