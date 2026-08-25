'use strict';

const assert = require('node:assert/strict');
const createJobRequestMessage = require('../dist/Projects/createJobRequestMessage.js').default;

const VIDEO_OPTIONS = {
  type: 'video',
  width: { min: 480, max: 1470, step: 8, default: 1280 },
  height: { min: 432, max: 1280, step: 8, default: 720 },
  sampler: { allowed: [], default: null },
  scheduler: { allowed: [], default: null }
};

function request(overrides) {
  return createJobRequestMessage(
    '00000000-0000-4000-8000-000000000001',
    {
      type: 'video',
      modelId: 'seedance-2-5',
      positivePrompt: 'Continue @Video1 after the final frame.',
      numberOfMedia: 1,
      duration: 5,
      width: 1280,
      height: 720,
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

const edit = request({
  referenceVideoUrls: ['https://cdn.example.com/source.mp4'],
  seedanceTaskType: 'edit'
});
assert.equal(edit.keyFrames[0].seedanceTaskType, 'edit');

const extend = request({
  referenceVideoUrls: ['https://cdn.example.com/source.mp4'],
  seedanceTaskType: 'extend'
});
assert.equal(extend.keyFrames[0].seedanceTaskType, 'extend');

const audioOnly = request({
  referenceAudioUrls: ['https://cdn.example.com/voice.mp3'],
  seedanceTaskType: 'reference'
});
assert.equal(audioOnly.keyFrames[0].seedanceTaskType, 'reference');

const maximumReferenceSet = request({
  referenceImageUrls: urls('image', 30, 'jpg'),
  referenceVideoUrls: urls('video', 10, 'mp4'),
  referenceAudioUrls: urls('audio', 10, 'mp3'),
  seedanceTaskType: 'reference'
});
assert.equal(maximumReferenceSet.keyFrames[0].referenceImageURLs.length, 30);
assert.equal(maximumReferenceSet.keyFrames[0].referenceVideoURLs.length, 10);
assert.equal(maximumReferenceSet.keyFrames[0].referenceAudioURLs.length, 10);

const frame = request({
  referenceImage: new Blob(['frame'], { type: 'image/png' })
});
assert.equal(frame.keyFrames[0].seedanceTaskType, undefined);

assert.throws(
  () => request({ seedanceTaskType: 'edit' }),
  /edit requires at least one reference video/
);
assert.throws(
  () =>
    request({
      modelId: 'seedance-2-0',
      referenceAudioUrls: ['https://cdn.example.com/voice.mp3']
    }),
  /audio references require at least one image or video reference/
);
assert.throws(
  () => request({ referenceVideoUrls: ['https://cdn.example.com/source.mp4'] }),
  /require seedanceTaskType/
);
assert.throws(
  () =>
    request({
      referenceAudioUrls: ['https://cdn.example.com/voice.mp3'],
      seedanceTaskType: 'auto'
    }),
  /must be reference, edit, or extend/
);
assert.throws(
  () =>
    request({
      referenceImage: new Blob(['frame'], { type: 'image/png' }),
      seedanceTaskType: 'reference'
    }),
  /omit it for first\/last-frame generation/
);

console.log('Seedance task-type transport checks passed');
