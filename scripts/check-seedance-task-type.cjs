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
  const modelId = 'seedance-2-5-uncensored';
  const uncensored = (overrides) => request({ modelId, ...overrides });

  for (const seedanceTaskType of ['edit', 'extend']) {
    const message = uncensored({
      referenceVideoUrls: ['https://cdn.example.com/source.mp4'],
      seedanceTaskType
    });
    assert.equal(message.keyFrames[0].modelID, modelId);
    assert.equal(message.keyFrames[0].seedanceTaskType, seedanceTaskType);
  }
  assert.equal(
    uncensored({
      referenceAudioUrls: ['https://cdn.example.com/voice.mp3'],
      seedanceTaskType: 'reference'
    }).keyFrames[0].seedanceTaskType,
    'reference'
  );
  assert.throws(
    () => uncensored({ referenceVideoUrls: ['https://cdn.example.com/source.mp4'] }),
    /require seedanceTaskType/
  );

  const maximum = uncensored({
    referenceImageUrls: urls('image', 30, 'jpg'),
    referenceVideoUrls: urls('video', 10, 'mp4'),
    referenceAudioUrls: urls('audio', 10, 'mp3'),
    seedanceTaskType: 'reference'
  });
  assert.equal(maximum.keyFrames[0].referenceImageURLs.length, 30);
  assert.equal(maximum.keyFrames[0].referenceVideoURLs.length, 10);
  assert.equal(maximum.keyFrames[0].referenceAudioURLs.length, 10);
  assert.throws(
    () =>
      uncensored({ referenceImageUrls: urls('image', 31, 'jpg'), seedanceTaskType: 'reference' }),
    /seedance-2-5-uncensored supports at most 30 image assets/
  );
  assert.throws(
    () =>
      uncensored({ referenceVideoUrls: urls('video', 11, 'mp4'), seedanceTaskType: 'reference' }),
    /seedance-2-5-uncensored supports at most 10 video assets/
  );
  assert.throws(
    () =>
      uncensored({ referenceAudioUrls: urls('audio', 11, 'mp3'), seedanceTaskType: 'reference' }),
    /seedance-2-5-uncensored supports at most 10 audio assets/
  );

  assert.equal(uncensored({ duration: 30 }).keyFrames[0].frames, 30 * 24 + 1);
  assert.equal(uncensored({ duration: 4 }).keyFrames[0].frames, 4 * 24 + 1);
  assert.throws(() => uncensored({ duration: 31 }), /less or equal 30, got 31/);
  assert.throws(() => uncensored({ duration: 3 }), /greater or equal 4, got 3/);

  const uncensoredExport = uncensored({ outputFormat: 'mov', returnLastFrame: true });
  assert.equal(uncensoredExport.outputFormat, 'mov');
  assert.equal(uncensoredExport.keyFrames[0].returnLastFrame, true);
  console.log('Seedance 2.5 Uncensored transport checks passed');
}

// Seedance 2.0 Mini Uncensored is the same model as Seedance 2.0 Mini under its
// own id: every Mini limit applies, it gets none of the 2.5-only options, and
// the id is never rewritten.
for (const modelId of ['seedance-2-0-mini', 'seedance-2-0-mini-uncensored']) {
  const mini = (overrides) => request({ modelId, ...overrides });

  const maximum = mini({
    referenceImageUrls: urls('image', 6, 'jpg'),
    referenceVideoUrls: urls('video', 3, 'mp4'),
    referenceAudioUrls: urls('audio', 3, 'mp3')
  });
  assert.equal(maximum.keyFrames[0].modelID, modelId);
  assert.equal(maximum.keyFrames[0].referenceImageURLs.length, 6);
  assert.equal(maximum.keyFrames[0].referenceVideoURLs.length, 3);
  assert.equal(maximum.keyFrames[0].referenceAudioURLs.length, 3);
  assert.equal(
    mini({ referenceImageUrls: urls('image', 9, 'jpg') }).keyFrames[0].referenceImageURLs.length,
    9
  );
  assert.throws(
    () => mini({ referenceImageUrls: urls('image', 10, 'jpg') }),
    new RegExp(`${modelId} supports at most 9 image assets`)
  );
  assert.throws(
    () => mini({ referenceVideoUrls: urls('video', 4, 'mp4') }),
    new RegExp(`${modelId} supports at most 3 video assets`)
  );
  assert.throws(
    () =>
      mini({
        referenceImageUrls: urls('image', 1, 'jpg'),
        referenceAudioUrls: urls('audio', 4, 'mp3')
      }),
    new RegExp(`${modelId} supports at most 3 audio assets`)
  );
  assert.throws(
    () =>
      mini({
        referenceImageUrls: urls('image', 9, 'jpg'),
        referenceVideoUrls: urls('video', 3, 'mp4'),
        referenceAudioUrls: urls('audio', 1, 'mp3')
      }),
    new RegExp(`${modelId} supports at most 12 total asset files`)
  );
  assert.throws(
    () => mini({ referenceAudioUrls: ['https://cdn.example.com/voice.mp3'] }),
    /audio references require at least one image or video reference/
  );
  assert.throws(
    () =>
      mini({
        referenceVideoUrls: ['https://cdn.example.com/source.mp4'],
        seedanceTaskType: 'edit'
      }),
    /supported only by Seedance 2.5/
  );

  assert.equal(mini({ duration: 15 }).keyFrames[0].frames, 15 * 24 + 1);
  assert.equal(mini({ duration: 4 }).keyFrames[0].frames, 4 * 24 + 1);
  assert.throws(() => mini({ duration: 16 }), /less or equal 15, got 16/);
  assert.throws(() => mini({ duration: 3 }), /greater or equal 4, got 3/);

  assert.throws(() => mini({ outputFormat: 'mov' }), /only by Seedance 2.5/);
  assert.throws(() => mini({ returnLastFrame: true }), /only by Seedance 2.5/);
}
console.log('Seedance 2.0 Mini Uncensored transport checks passed');
