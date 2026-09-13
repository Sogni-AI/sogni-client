'use strict';
/**
 * MiniMax H3 FastH3 audio guide: an uploaded audio drives the video in three
 * modes, each with a standard-size and a two-stage id:
 *
 * - ia2v   `minimax-h3-fastvideo-int8_ia2v_turbo[_2stage]`   referenceImage + referenceAudio
 * - flfa2v `minimax-h3-fastvideo-int8_flfa2v_turbo[_2stage]` referenceImage + referenceImageEnd + referenceAudio
 * - a2v    `minimax-h3-fastvideo-int8_a2v_turbo[_2stage]`    referenceAudio only
 *
 * Runs against compiled output so it also checks the published API shape.
 *
 * - each mode requires exactly its uploads and refuses any other upload;
 * - the shared H3 grids apply (24 fps, 124 + n*17 frames, 32px canvas, 4 steps);
 * - generateAudio false, LoRAs, audioDuration, an invalid audioStart and the
 *   retired outputScale are refused;
 * - a two-stage request is the base request with only the model id changed;
 * - other H3 ids refuse referenceAudio (except r2v) and audioStart;
 * - getMinimaxH3FramesForAudioDuration returns the smallest covering frame count.
 */
const assert = require('node:assert/strict');
const create = require('../dist/Projects/createJobRequestMessage.js').default;
const sdk = require('../dist/index.js');
const { getVideoWorkflowType, getVideoAssetRequirements } = require('../dist/Projects/utils/index.js');

const MODES = {
  ia2v: {
    baseId: 'minimax-h3-fastvideo-int8_ia2v_turbo',
    constant: 'MINIMAX_H3_FASTH3_IA2V_MODEL_ID',
    uploads: ['referenceImage', 'referenceAudio']
  },
  flfa2v: {
    baseId: 'minimax-h3-fastvideo-int8_flfa2v_turbo',
    constant: 'MINIMAX_H3_FASTH3_FLFA2V_MODEL_ID',
    uploads: ['referenceImage', 'referenceImageEnd', 'referenceAudio']
  },
  a2v: {
    baseId: 'minimax-h3-fastvideo-int8_a2v_turbo',
    constant: 'MINIMAX_H3_FASTH3_A2V_MODEL_ID',
    uploads: ['referenceAudio']
  }
};
const options = {
  type: 'video',
  sampler: { allowed: [], default: null },
  scheduler: { allowed: [], default: null }
};
const image = new Blob(['image'], { type: 'image/png' });
const audio = new Blob(['audio'], { type: 'audio/mpeg' });
const uploadValue = { referenceImage: image, referenceImageEnd: image, referenceAudio: audio };
const keyFlag = {
  referenceImage: 'hasReferenceImage',
  referenceImageEnd: 'hasReferenceImageEnd',
  referenceAudio: 'hasReferenceAudio'
};

let checkedIds = 0;
for (const [workflow, { baseId, constant, uploads }] of Object.entries(MODES)) {
  const twoStageId = `${baseId}_2stage`;
  assert.equal(sdk[constant], baseId);

  for (const modelId of [baseId, twoStageId]) {
    const params = (changes = {}) => ({
      type: 'video',
      modelId,
      positivePrompt: 'The singer performs the uploaded song under warm stage light.',
      numberOfMedia: 1,
      frames: 243,
      width: 1344,
      height: 768,
      steps: 4,
      guidance: 1,
      ...Object.fromEntries(uploads.map((field) => [field, uploadValue[field]])),
      ...changes
    });
    const keyFrame = (changes) => create(`h3-${workflow}`, params(changes), options).keyFrames[0];
    const rejects = (changes, pattern, label) =>
      assert.throws(
        () => keyFrame(changes),
        pattern,
        `${modelId}: ${label ?? JSON.stringify(Object.keys(changes))}`
      );

    // Identity.
    assert.equal(sdk.isVideoModel(modelId), true, modelId);
    assert.equal(sdk.isMinimaxH3AudioGuideModel(modelId), true, modelId);
    assert.equal(getVideoWorkflowType(modelId), workflow, modelId);
    for (const [field, requirement] of Object.entries(getVideoAssetRequirements(modelId))) {
      assert.equal(requirement, uploads.includes(field) ? 'required' : 'forbidden', `${modelId} ${field}`);
    }

    // Request shape.
    const plain = keyFrame();
    assert.equal(plain.modelID, modelId);
    for (const field of ['referenceImage', 'referenceImageEnd', 'referenceAudio']) {
      assert.equal(plain[keyFlag[field]] === true, uploads.includes(field), `${modelId} ${keyFlag[field]}`);
    }
    assert.equal('hasReferenceAudio1' in plain, false, 'driving audio is not an r2v reference slot');
    assert.equal(plain.fps, 24);
    assert.equal(plain.frames, 243);
    assert.equal(plain.steps, 4);
    assert.equal(plain.width, 1344);
    assert.equal(plain.height, 768);
    for (const absent of ['outputScale', 'generateAudio', 'audioStart', 'audioDuration', 'loras', 'negativePrompt']) {
      assert.equal(absent in plain, false, `${modelId}: ${absent} is not sent by default`);
    }
    assert.equal(keyFrame({ audioStart: 2.5 }).audioStart, 2.5);
    assert.equal(keyFrame({ audioStart: 0 }).audioStart, 0);
    assert.equal(keyFrame({ generateAudio: true }).generateAudio, true);
    assert.deepEqual(keyFrame({ loras: [], loraStrengths: [] }), plain, 'empty LoRA arrays send nothing');
    assert.equal(keyFrame({ frames: undefined, duration: 10 }).frames, 243);
    for (const frames of [124, 141, 362]) assert.equal(keyFrame({ frames }).frames, frames);
    for (const [width, height] of [
      [768, 1344],
      [960, 544],
      [672, 384]
    ]) {
      assert.equal(keyFrame({ width, height }).width, width);
    }
    if (modelId === twoStageId) {
      // The two-stage request is the base request with only the id changed.
      const base = create(`h3-${workflow}`, { ...params(), modelId: baseId }, options).keyFrames[0];
      assert.deepEqual({ ...plain, modelID: baseId }, base, `${modelId} mirrors ${baseId}`);
    }

    // Exactly the mode's uploads.
    for (const field of uploads) {
      rejects({ [field]: undefined }, new RegExp(`${workflow} workflow requires ${field}`));
    }
    for (const field of ['referenceImage', 'referenceImageEnd'].filter((f) => !uploads.includes(f))) {
      rejects({ [field]: image }, new RegExp(`${workflow} workflow does not support ${field}`));
    }
    rejects({ referenceVideo: image }, new RegExp(`${workflow} workflow does not support referenceVideo`));
    rejects(
      { referenceAudioIdentity: audio },
      new RegExp(`${workflow} workflow does not support referenceAudioIdentity`)
    );
    rejects({ contextImages: [image] }, /contextImages is supported only by the MiniMax H3 r2v workflow/);
    rejects({ referenceAudios: [audio] }, /referenceAudios is supported only by the MiniMax H3 r2v workflow/);
    rejects({ referenceVideos: [image] }, /referenceVideos is supported only by the MiniMax H3 r2v workflow/);
    rejects({ referenceAudioUrls: ['https://example.com/a.mp3'] }, /External reference URLs are supported only/);

    // Shared H3 grids and fixed controls.
    rejects({ fps: 30 }, /MiniMax H3 fps is fixed at 24/);
    rejects({ steps: 8 }, /MiniMax H3 Turbo steps are fixed at 4/);
    rejects({ guidance: 2 }, /MiniMax H3 guidance is fixed at 1/);
    rejects({ negativePrompt: 'blur' }, /MiniMax H3 has no negative-prompt input/);
    for (const frames of [121, 125, 123, 379, 364]) {
      rejects({ frames }, /MiniMax H3 frames must be 124 \+ n\*17/, `frames ${frames}`);
    }
    for (const [width, height] of [
      [1000, 768],
      [1376, 768],
      [1344, 1344],
      [1920, 1088],
      [1344, undefined]
    ]) {
      rejects({ width, height }, /MiniMax H3 (dimensions|width and height)/, `${width}x${height}`);
    }

    // Audio-guide refusals.
    for (const outputScale of [2, 1, 0, '2', null]) {
      rejects({ outputScale }, /outputScale is no longer supported/, `outputScale ${String(outputScale)}`);
    }
    rejects(
      { generateAudio: false },
      new RegExp(`MiniMax H3 ${workflow} output always carries the uploaded audio`)
    );
    for (const loraChanges of [
      { loras: ['h3-realism-people'] },
      { loraStrengths: [1] },
      { loras: ['h3-realism-people'], loraStrengths: [0.8] }
    ]) {
      rejects(loraChanges, new RegExp(`MiniMax H3 ${workflow} does not support LoRAs`));
    }
    rejects({ audioDuration: 10 }, /MiniMax H3 has no audioDuration input/);
    for (const audioStart of [-1, Number.NaN, Number.POSITIVE_INFINITY, '1']) {
      rejects(
        { audioStart },
        new RegExp(`MiniMax H3 ${workflow} audioStart must be a number of seconds`),
        `audioStart ${String(audioStart)}`
      );
    }
    checkedIds += 1;
  }
}
assert.equal(checkedIds, 6, 'all six audio-guide ids are covered');

// Every other H3 id: referenceAudio is refused except on r2v (a labelled
// reference there), and the audio window controls are refused everywhere.
const otherH3 = [
  ['minimax-h3-fl2va-fp8_t2v', 20],
  ['minimax-h3-fl2va-fp8_i2v', 20],
  ['minimax-h3-fl2va-fp8_flf2v', 20],
  ['minimax-h3-ref2va-fp8_r2v', 20],
  ['minimax-h3-fl2va-fp8_t2v_turbo', 4],
  ['minimax-h3-fl2va-fp8_i2v_turbo', 4],
  ['minimax-h3-fl2va-fp8_flf2v_turbo', 4],
  ['minimax-h3-ref2va-fp8_r2v_turbo', 4],
  ['minimax-h3-fastvideo-int8_t2v_turbo', 4],
  ['minimax-h3-fastvideo-int8_i2v_turbo', 4],
  ['minimax-h3-fastvideo-int8_flf2v_turbo', 4],
  ['minimax-h3-fastvideo-int8_t2v_turbo_2stage', 4],
  ['minimax-h3-fastvideo-int8_i2v_turbo_2stage', 4],
  ['minimax-h3-fastvideo-int8_flf2v_turbo_2stage', 4],
  ['minimax-h3-fastvideo-int8_t2v_turbo_2stage_720p', 4],
  ['minimax-h3-fastvideo-int8_i2v_turbo_2stage_720p', 4],
  ['minimax-h3-fastvideo-int8_flf2v_turbo_2stage_720p', 4],
  ['minimax-h3-fl2va-fp8_t2v_balanced', 8],
  ['minimax-h3-fl2va-fp8_i2v_balanced', 8],
  ['minimax-h3-fl2va-fp8_flf2v_balanced', 8],
  ['minimax-h3-ref2va-fp8_r2v_balanced', 8]
];
for (const [modelId, steps] of otherH3) {
  assert.equal(sdk.isMinimaxH3AudioGuideModel(modelId), false, modelId);
  const base = {
    type: 'video',
    modelId,
    positivePrompt: 'A kite over a beach.',
    numberOfMedia: 1,
    frames: 243,
    width: 1344,
    height: 768,
    steps,
    guidance: 1,
    ...(/_i2v|_flf2v|_r2v/.test(modelId) ? { referenceImage: image } : {}),
    ...(/_flf2v/.test(modelId) ? { referenceImageEnd: image } : {})
  };
  const request = (changes) => create(`h3-${modelId}`, { ...base, ...changes }, options).keyFrames[0];
  assert.equal('hasReferenceAudio' in request({}), false, `${modelId}: baseline sends no audio`);
  if (/_r2v/.test(modelId)) {
    assert.equal(request({ referenceAudio: audio }).hasReferenceAudio1, true, `${modelId}: r2v audio`);
  } else {
    assert.throws(
      () => request({ referenceAudio: audio }),
      /workflow does not support referenceAudio/,
      `${modelId}: referenceAudio must be refused`
    );
  }
  assert.throws(
    () => request({ audioStart: 1 }),
    /audioStart is supported only by the MiniMax H3 FastH3 audio-guide workflows/,
    `${modelId}: audioStart must be refused`
  );
  assert.throws(
    () => request({ audioDuration: 6 }),
    /MiniMax H3 has no audioDuration input/,
    `${modelId}: audioDuration must be refused`
  );
}
// Non-H3 spellings and families are not audio-guide ids.
for (const modelId of [
  'minimax-h3-fl2va-fp8_ia2v_turbo',
  'minimax-h3-fastvideo-int8_ia2v',
  'minimax-h3-fastvideo-int8_flfa2v_balanced',
  'ltx23-22b-fp8_ia2v_distilled',
  'ltx23-22b-fp8_a2v_distilled'
]) {
  assert.equal(sdk.isMinimaxH3AudioGuideModel(modelId), false, modelId);
}
assert.equal(getVideoWorkflowType('ltx23-22b-fp8_a2v_distilled'), 'a2v');
assert.equal(getVideoWorkflowType('ltx23-22b-fp8_ia2v_distilled'), 'ia2v');

// Frame count that covers an audio clip.
const framesFor = sdk.getMinimaxH3FramesForAudioDuration;
for (const [seconds, frames] of [
  [0.5, 124],
  [5, 124],
  [124 / 24, 124],
  [124.01 / 24, 141],
  [141 / 24, 141],
  [6, 158],
  [10, 243],
  [243 / 24, 243],
  [362 / 24, 362],
  [15.1, 362],
  [60, 362]
]) {
  assert.equal(framesFor(seconds), frames, `${seconds}s -> ${frames} frames`);
}
for (let tenths = 1; tenths <= 200; tenths += 1) {
  const seconds = tenths / 10;
  const frames = framesFor(seconds);
  assert.equal((frames - 124) % 17, 0, `${seconds}s is on the grid`);
  assert.ok(frames >= 124 && frames <= 362, `${seconds}s is in range`);
  if (frames < 362) {
    assert.ok(frames >= seconds * 24 - 1e-6, `${seconds}s is covered`);
    assert.ok(frames - 17 < 124 || frames - 17 < seconds * 24, `${seconds}s is the smallest cover`);
  }
}
for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, undefined, '5']) {
  assert.throws(() => framesFor(bad), RangeError, `audio duration ${String(bad)} must be refused`);
}

console.log('MiniMax H3 audio-guide request checks passed');
