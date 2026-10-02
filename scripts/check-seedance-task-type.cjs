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

const exported = request({ outputFormat: 'mov', returnLastFrame: true });
assert.equal(exported.outputFormat, 'mov');
assert.equal(exported.keyFrames[0].returnLastFrame, true);
assert.equal(request({}).outputFormat, 'mp4');
assert.equal(request({}).keyFrames[0].returnLastFrame, undefined);
assert.throws(() => request({ outputFormat: 'avi' }), /must be mp4 or mov/);
assert.throws(() => request({ modelId: 'seedance-2-0', outputFormat: 'mov' }), /only by Seedance 2.5/);
assert.throws(() => request({ modelId: 'seedance-2-0', returnLastFrame: true }), /only by Seedance 2.5/);
assert.throws(() => request({ returnLastFrame: 'true' }), /must be a boolean/);
console.log('Seedance export transport checks passed');

// Seedance 2.5 Uncensored is the same model as Seedance 2.5 under its own id:
// every 2.5 capability and limit applies, and the id is never rewritten.
{
  const modelId = 'seedance-2-5-spicy';
  const spicy = (overrides) => request({ modelId, ...overrides });

  for (const seedanceTaskType of ['edit', 'extend']) {
    const message = spicy({
      referenceVideoUrls: ['https://cdn.example.com/source.mp4'],
      seedanceTaskType
    });
    assert.equal(message.keyFrames[0].modelID, modelId);
    assert.equal(message.keyFrames[0].seedanceTaskType, seedanceTaskType);
  }
  assert.equal(
    spicy({
      referenceAudioUrls: ['https://cdn.example.com/voice.mp3'],
      seedanceTaskType: 'reference'
    }).keyFrames[0].seedanceTaskType,
    'reference'
  );
  assert.throws(
    () => spicy({ referenceVideoUrls: ['https://cdn.example.com/source.mp4'] }),
    /require seedanceTaskType/
  );

  const maximum = spicy({
    referenceImageUrls: urls('image', 30, 'jpg'),
    referenceVideoUrls: urls('video', 10, 'mp4'),
    referenceAudioUrls: urls('audio', 10, 'mp3'),
    seedanceTaskType: 'reference'
  });
  assert.equal(maximum.keyFrames[0].referenceImageURLs.length, 30);
  assert.equal(maximum.keyFrames[0].referenceVideoURLs.length, 10);
  assert.equal(maximum.keyFrames[0].referenceAudioURLs.length, 10);
  assert.throws(
    () => spicy({ referenceImageUrls: urls('image', 31, 'jpg'), seedanceTaskType: 'reference' }),
    /seedance-2-5-spicy supports at most 30 image assets/
  );
  assert.throws(
    () => spicy({ referenceVideoUrls: urls('video', 11, 'mp4'), seedanceTaskType: 'reference' }),
    /seedance-2-5-spicy supports at most 10 video assets/
  );
  assert.throws(
    () => spicy({ referenceAudioUrls: urls('audio', 11, 'mp3'), seedanceTaskType: 'reference' }),
    /seedance-2-5-spicy supports at most 10 audio assets/
  );

  assert.equal(spicy({ duration: 30 }).keyFrames[0].frames, 30 * 24 + 1);
  assert.equal(spicy({ duration: 4 }).keyFrames[0].frames, 4 * 24 + 1);
  assert.throws(() => spicy({ duration: 31 }), /less or equal 30, got 31/);
  assert.throws(() => spicy({ duration: 3 }), /greater or equal 4, got 3/);

  const spicyExport = spicy({ outputFormat: 'mov', returnLastFrame: true });
  assert.equal(spicyExport.outputFormat, 'mov');
  assert.equal(spicyExport.keyFrames[0].returnLastFrame, true);
  console.log('Seedance 2.5 Uncensored transport checks passed');
}
