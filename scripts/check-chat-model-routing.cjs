const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { EventEmitter } = require('node:events');
const hostedAliasParityVector = require('./fixtures/hosted-tool-alias-parity.generated.json');
const {
  PREFERRED_MODEL_IDS,
  assertHostedToolArguments,
  asBooleanValue,
  asFiniteNumber,
  asStringArray,
  clampVariationCount,
  getHostedVariationCount,
  getVideoDefaults,
  getVideoWorkflowType,
  isEditImageModel,
  isNonEmptyString,
  normalizeTimeSignature,
  normalizeVideoControlMode,
  resolveHostedToolModelSelector,
  selectBackboneModel,
  serializeUnknownError,
  validateHostedToolArguments
} = require('../dist/Chat/modelRouting.js');
const { parseCreativeWorkflowSseChunk } = require('../dist/CreativeWorkflows/index.js');
const createJobRequestMessage = require('../dist/Projects/createJobRequestMessage.js').default;
const {
  calculateVideoFrames,
  getVideoAssetRequirements,
  isMinimaxH3Model,
  MINIMAX_H3_R2V_ASSETS,
  VIDEO_WORKFLOW_ASSETS
} = require('../dist/Projects/utils/index.js');
const {
  getMaxContextImages,
  isComfyModel,
  validateCustomImageSize
} = require('../dist/lib/validation.js');
const { SogniTools } = require('../dist/Chat/tools.js');
const ChatToolsApi = require('../dist/Chat/ChatTools.js').default;

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => [key, stableValue(entryValue)])
  );
}

function sha256(value) {
  return createHash('sha256')
    .update(JSON.stringify(stableValue(value)))
    .digest('hex');
}

// Hosted creative-tool surface parity: `SogniTools.all` is the full canonical
// surface mirrored from @sogni/creative-agent.
const sdkHostedToolsByName = new Map(SogniTools.all.map((tool) => [tool.function.name, tool]));

for (const expectedHostedName of new Set(
  hostedAliasParityVector.tools.map((vector) => vector.hostedToolName)
)) {
  assert.ok(
    sdkHostedToolsByName.has(expectedHostedName),
    `SDK is missing canonical hosted creative tool: ${expectedHostedName}`
  );
}

for (const vector of hostedAliasParityVector.tools) {
  const tool = sdkHostedToolsByName.get(vector.hostedToolName);
  assert.ok(tool, `Missing generated SDK hosted tool: ${vector.hostedToolName}`);
  assert.equal(vector.sdkToolName, vector.hostedToolName);

  const parameters = tool.function.parameters || {};
  const properties = parameters.properties || {};
  assert.equal(
    vector.hostedSchemaSha256,
    sha256({ name: tool.function.name, parameters }),
    `${vector.hostedToolName} schema fingerprint must match hosted alias parity vector`
  );
  assert.deepEqual(vector.hostedRequired, parameters.required || []);
  assert.deepEqual(vector.hostedPropertyNames, Object.keys(properties));

  for (const target of [...vector.argumentAliasTargets, ...vector.mediaAliasTargets]) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(properties, target),
      `${vector.creativeToolName} alias target ${target} must exist on ${vector.hostedToolName}`
    );
  }
}

const models = [
  { id: 'z_image_turbo_bf16', media: 'image', workerCount: 12 },
  { id: 'qwen_image_edit_2511_fp8_lightning', media: 'image', workerCount: 8 },
  { id: PREFERRED_MODEL_IDS.image.krea2IdentityEdit, media: 'image', workerCount: 7 },
  { id: PREFERRED_MODEL_IDS.image.darkBeastKrea2IdentityEdit, media: 'image', workerCount: 6 },
  { id: 'flux2_dev_fp8', media: 'image', workerCount: 1 },
  { id: PREFERRED_MODEL_IDS.video.t2v, media: 'video', workerCount: 1 },
  { id: 'wan_v2.2-14b-fp8_t2v_lightx2v', media: 'video', workerCount: 20 },
  { id: PREFERRED_MODEL_IDS.video.i2v, media: 'video', workerCount: 4 },
  { id: PREFERRED_MODEL_IDS.video.ia2v, media: 'video', workerCount: 3 },
  { id: PREFERRED_MODEL_IDS.video.s2v, media: 'video', workerCount: 9 },
  { id: PREFERRED_MODEL_IDS.video.animateMove, media: 'video', workerCount: 6 },
  { id: PREFERRED_MODEL_IDS.video.v2v, media: 'video', workerCount: 2 },
  { id: PREFERRED_MODEL_IDS.video.seedanceT2v, media: 'video', workerCount: 999 },
  { id: PREFERRED_MODEL_IDS.video.seedanceI2v, media: 'video', workerCount: 999 },
  { id: PREFERRED_MODEL_IDS.video.seedanceIa2v, media: 'video', workerCount: 999 },
  { id: PREFERRED_MODEL_IDS.video.seedanceMiniT2v, media: 'video', workerCount: 999 },
  { id: PREFERRED_MODEL_IDS.video.seedanceMiniI2v, media: 'video', workerCount: 999 },
  { id: PREFERRED_MODEL_IDS.video.seedanceFastT2v, media: 'video', workerCount: 999 },
  { id: PREFERRED_MODEL_IDS.video.seedanceFastI2v, media: 'video', workerCount: 999 },
  { id: PREFERRED_MODEL_IDS.video.seedanceV2v, media: 'video', workerCount: 999 },
  { id: PREFERRED_MODEL_IDS.video.happyhorseT2v, media: 'video', workerCount: 999 },
  { id: PREFERRED_MODEL_IDS.video.happyhorseI2v, media: 'video', workerCount: 999 },
  { id: PREFERRED_MODEL_IDS.video.happyhorseR2v, media: 'video', workerCount: 999 },
  { id: PREFERRED_MODEL_IDS.audio.aceStepXlTurbo, media: 'audio', workerCount: 1 },
  { id: PREFERRED_MODEL_IDS.audio.aceStepXlSft, media: 'audio', workerCount: 10 },
  { id: PREFERRED_MODEL_IDS.audio.aceStepTurbo, media: 'audio', workerCount: 1 },
  { id: PREFERRED_MODEL_IDS.audio.aceStepSft, media: 'audio', workerCount: 20 }
];

assert.equal(clampVariationCount(99), 16);
assert.equal(clampVariationCount(0), 1);
assert.equal(clampVariationCount(3.6), 4);
assert.equal(clampVariationCount(undefined, 5), 5);

assert.deepEqual(
  selectBackboneModel(models, {
    mediaType: 'video',
    requestedModel: 'wan_v2.2-14b-fp8_t2v_lightx2v',
    workflows: ['t2v'],
    preferredModelIds: [PREFERRED_MODEL_IDS.video.t2v]
  }),
  {
    modelId: 'wan_v2.2-14b-fp8_t2v_lightx2v',
    model: { id: 'wan_v2.2-14b-fp8_t2v_lightx2v', media: 'video', workerCount: 20 },
    selectedBy: 'requestedModel'
  }
);

assert.equal(
  selectBackboneModel(models, {
    mediaType: 'video',
    requestedModel: PREFERRED_MODEL_IDS.video.i2v,
    workflows: ['t2v'],
    preferredModelIds: [PREFERRED_MODEL_IDS.video.t2v]
  }).modelId,
  PREFERRED_MODEL_IDS.video.t2v
);

assert.equal(
  selectBackboneModel(models, {
    mediaType: 'video',
    requestedModel: PREFERRED_MODEL_IDS.video.seedanceFastT2v,
    workflows: ['t2v'],
    preferredModelIds: [PREFERRED_MODEL_IDS.video.t2v]
  }).modelId,
  PREFERRED_MODEL_IDS.video.seedanceFastT2v
);

assert.equal(
  selectBackboneModel(models, {
    mediaType: 'video',
    workflows: ['ia2v', 's2v'],
    preferredModelIds: [PREFERRED_MODEL_IDS.video.ia2v, PREFERRED_MODEL_IDS.video.s2v]
  }).modelId,
  PREFERRED_MODEL_IDS.video.ia2v
);

assert.equal(
  selectBackboneModel(models, {
    mediaType: 'video',
    workflows: ['animate-move'],
    preferredModelIds: [PREFERRED_MODEL_IDS.video.animateMove]
  }).modelId,
  PREFERRED_MODEL_IDS.video.animateMove
);

assert.equal(
  selectBackboneModel(models, {
    mediaType: 'audio',
    preferredModelIds: Object.values(PREFERRED_MODEL_IDS.audio)
  }).modelId,
  PREFERRED_MODEL_IDS.audio.aceStepXlTurbo
);

assert.equal(
  selectBackboneModel(models, {
    mediaType: 'image',
    filter: isEditImageModel
  }).modelId,
  'qwen_image_edit_2511_fp8_lightning'
);

assert.throws(
  () => selectBackboneModel(models, { mediaType: 'video', workflows: ['a2v'] }),
  /No compatible video models available for workflows: a2v/
);

assert.deepEqual(getVideoDefaults(PREFERRED_MODEL_IDS.video.t2v), {
  width: 1920,
  height: 1088,
  fps: 24
});
assert.deepEqual(getVideoDefaults(PREFERRED_MODEL_IDS.video.s2v), {
  width: 832,
  height: 480,
  fps: 16
});
assert.deepEqual(getVideoDefaults(PREFERRED_MODEL_IDS.video.seedanceT2v), {
  width: 1920,
  height: 1080,
  fps: 24
});
assert.deepEqual(getVideoDefaults(PREFERRED_MODEL_IDS.video.seedanceMiniT2v), {
  width: 1280,
  height: 720,
  fps: 24
});
assert.deepEqual(getVideoDefaults(PREFERRED_MODEL_IDS.video.seedanceFastT2v), {
  width: 1280,
  height: 720,
  fps: 24
});
assert.deepEqual(getVideoDefaults(PREFERRED_MODEL_IDS.video.happyhorseT2v), {
  width: 1920,
  height: 1080,
  fps: 24
});
assert.deepEqual(getVideoDefaults(PREFERRED_MODEL_IDS.video.happyhorseI2v), {
  width: 1920,
  height: 1080,
  fps: 24
});
assert.deepEqual(getVideoDefaults(PREFERRED_MODEL_IDS.video.happyhorseR2v), {
  width: 1920,
  height: 1080,
  fps: 24
});

// HappyHorse encodes the workflow in the model id (hyphenated suffixes).
assert.equal(getVideoWorkflowType(PREFERRED_MODEL_IDS.video.happyhorseT2v), 't2v');
assert.equal(getVideoWorkflowType(PREFERRED_MODEL_IDS.video.happyhorseI2v), 'i2v');
assert.equal(getVideoWorkflowType(PREFERRED_MODEL_IDS.video.happyhorseR2v), 'r2v');

const minimaxH3ModelIds = {
  t2v: 'minimax-h3-fl2va-fp8_t2v',
  i2v: 'minimax-h3-fl2va-fp8_i2v',
  flf2v: 'minimax-h3-fl2va-fp8_flf2v',
  // Separate Ref2VA checkpoint. The 'ref2va' segment must not be mistaken for a
  // workflow suffix, exactly like the 'fl2va' segment on the other three.
  r2v: 'minimax-h3-ref2va-fp8_r2v'
};
assert.ok(Object.values(minimaxH3ModelIds).every(isMinimaxH3Model));
assert.equal(getVideoWorkflowType(minimaxH3ModelIds.t2v), 't2v');
assert.equal(getVideoWorkflowType(minimaxH3ModelIds.i2v), 'i2v');
assert.equal(getVideoWorkflowType(minimaxH3ModelIds.flf2v), 'flf2v');
assert.equal(getVideoWorkflowType(minimaxH3ModelIds.r2v), 'r2v');
assert.deepEqual(getVideoDefaults(minimaxH3ModelIds.r2v), {
  width: 1344,
  height: 768,
  fps: 24
});
assert.equal(PREFERRED_MODEL_IDS.video.minimaxH3T2v, minimaxH3ModelIds.t2v);
assert.equal(PREFERRED_MODEL_IDS.video.minimaxH3I2v, minimaxH3ModelIds.i2v);
assert.equal(PREFERRED_MODEL_IDS.video.minimaxH3Flf2v, minimaxH3ModelIds.flf2v);
assert.equal(calculateVideoFrames(minimaxH3ModelIds.t2v, 5, 24, 125), 141);
assert.equal(calculateVideoFrames(minimaxH3ModelIds.t2v, 5, 24, undefined, 125), 124);
assert.throws(
  () => calculateVideoFrames(minimaxH3ModelIds.t2v, 5, 24, 125, 130),
  /No valid MiniMax H3 frame count exists/
);
assert.equal(
  resolveHostedToolModelSelector('generate_video', { videoModel: 'minimax-h3-t2v' }),
  minimaxH3ModelIds.t2v
);
assert.deepEqual(getVideoDefaults(minimaxH3ModelIds.t2v), { width: 1344, height: 768, fps: 24 });
assert.equal(calculateVideoFrames(minimaxH3ModelIds.t2v, 5, 60), 124);
assert.equal(calculateVideoFrames(minimaxH3ModelIds.t2v, 8, 60), 192);
assert.equal(calculateVideoFrames(minimaxH3ModelIds.t2v, 10, 60), 243);
assert.equal(calculateVideoFrames(minimaxH3ModelIds.t2v, 15, 60), 362);
assert.deepEqual(VIDEO_WORKFLOW_ASSETS.flf2v, {
  referenceImage: 'required',
  referenceImageEnd: 'required',
  referenceAudio: 'forbidden',
  referenceAudioIdentity: 'forbidden',
  referenceVideo: 'forbidden',
  referenceMask: 'forbidden'
});

// r2v is shared by two model families with different asset rules, so the
// requirements must be resolved per model id, not per workflow type.
assert.deepEqual(getVideoAssetRequirements(PREFERRED_MODEL_IDS.video.happyhorseR2v), {
  referenceImage: 'optional',
  referenceImageEnd: 'forbidden',
  referenceAudio: 'forbidden',
  referenceAudioIdentity: 'forbidden',
  referenceVideo: 'forbidden',
  referenceMask: 'forbidden'
});
// MiniMax H3 r2v has no frame anchors: referenceImage is only an alias for
// reference 1 (hence 'optional' - contextImages or referenceImageUrls can
// supply it), there is no closing frame, and reference video/audio are ordinary
// references rather than drivers.
assert.deepEqual(getVideoAssetRequirements(minimaxH3ModelIds.r2v), {
  referenceImage: 'optional',
  referenceImageEnd: 'forbidden',
  referenceAudio: 'optional',
  referenceAudioIdentity: 'forbidden',
  referenceVideo: 'optional',
  referenceMask: 'forbidden'
});
assert.deepEqual(getVideoAssetRequirements(minimaxH3ModelIds.r2v), MINIMAX_H3_R2V_ASSETS);
assert.deepEqual(getVideoAssetRequirements(minimaxH3ModelIds.flf2v), VIDEO_WORKFLOW_ASSETS.flf2v);
assert.equal(getVideoAssetRequirements('not-a-video-model'), null);

const minimaxH3Options = {
  type: 'video',
  steps: { min: 20, max: 20, step: 1, default: 20 },
  guidance: { min: 1, max: 1, step: 1, default: 1 },
  fps: { allowed: [24], default: 24 },
  sampler: { allowed: ['res_multistep'], default: 'res_multistep' },
  scheduler: { allowed: ['simple'], default: 'simple' }
};
const minimaxH3Params = {
  type: 'video',
  modelId: minimaxH3ModelIds.t2v,
  numberOfMedia: 1,
  positivePrompt: 'A continuous cinematic shot with synchronized location sound.',
  duration: 10,
  width: 1344,
  height: 768,
  steps: 20,
  guidance: 1,
  sampler: 'res_multistep',
  scheduler: 'simple'
};
const minimaxH3Request = createJobRequestMessage(
  'h3-test',
  { ...minimaxH3Params, generateAudio: false },
  minimaxH3Options
);
assert.equal(minimaxH3Request.keyFrames[0].fps, 24);
assert.equal(minimaxH3Request.keyFrames[0].frames, 243);
assert.equal(minimaxH3Request.keyFrames[0].width, 1344);
assert.equal(minimaxH3Request.keyFrames[0].height, 768);
assert.equal('negativePrompt' in minimaxH3Request.keyFrames[0], false);
assert.equal(minimaxH3Request.keyFrames[0].generateAudio, false);
// The numbered context-image slots belong to r2v alone: an FL2VA request must
// carry no hasContextImage flags at all, not even false ones.
assert.deepEqual(
  Object.keys(minimaxH3Request.keyFrames[0]).filter((key) => key.startsWith('hasContextImage')),
  []
);
assert.throws(
  () => createJobRequestMessage('h3-bad-fps', { ...minimaxH3Params, fps: 25 }, minimaxH3Options),
  /MiniMax H3 fps is fixed at 24/
);
assert.throws(
  () =>
    createJobRequestMessage(
      'h3-bad-negative',
      { ...minimaxH3Params, negativePrompt: 'blurry' },
      minimaxH3Options
    ),
  /MiniMax H3 has no negative-prompt input/
);
assert.throws(
  () =>
    createJobRequestMessage(
      'h3-missing-end',
      {
        ...minimaxH3Params,
        modelId: minimaxH3ModelIds.flf2v,
        referenceImage: true
      },
      minimaxH3Options
    ),
  /flf2v workflow requires referenceImageEnd/
);
const minimaxH3R2vParams = { ...minimaxH3Params, modelId: minimaxH3ModelIds.r2v };
assert.throws(
  () => createJobRequestMessage('h3-r2v-no-reference', minimaxH3R2vParams, minimaxH3Options),
  /MiniMax H3 r2v needs at least one uploaded reference image/
);
// Reference video and audio add to the image set rather than replacing it.
assert.throws(
  () =>
    createJobRequestMessage(
      'h3-r2v-media-only',
      { ...minimaxH3R2vParams, referenceVideo: true, referenceAudio: true },
      minimaxH3Options
    ),
  /MiniMax H3 r2v needs at least one uploaded reference image/
);

// referenceImage is reference 1 and contextImages carries 2..9, so the flags
// have to land on distinct upload slots. Slot 1 stays free for referenceImage.
const minimaxH3R2vRequest = createJobRequestMessage(
  'h3-r2v',
  { ...minimaxH3R2vParams, referenceImage: true, contextImages: [true, true] },
  minimaxH3Options
);
assert.equal(minimaxH3R2vRequest.keyFrames[0].hasReferenceImage, true);
assert.equal(minimaxH3R2vRequest.keyFrames[0].hasContextImage1, undefined);
assert.equal(minimaxH3R2vRequest.keyFrames[0].hasContextImage2, true);
assert.equal(minimaxH3R2vRequest.keyFrames[0].hasContextImage3, true);
assert.equal(minimaxH3R2vRequest.keyFrames[0].hasContextImage4, undefined);

// Without referenceImage the same list starts at slot 1, so <Picture 1> is
// still the first entry the caller passed.
const minimaxH3R2vContextOnly = createJobRequestMessage(
  'h3-r2v-context-only',
  { ...minimaxH3R2vParams, contextImages: [true, true] },
  minimaxH3Options
);
assert.equal(minimaxH3R2vContextOnly.keyFrames[0].hasReferenceImage, undefined);
assert.equal(minimaxH3R2vContextOnly.keyFrames[0].hasContextImage1, true);
assert.equal(minimaxH3R2vContextOnly.keyFrames[0].hasContextImage2, true);
assert.equal(minimaxH3R2vContextOnly.keyFrames[0].hasContextImage3, undefined);

// Nine references fit; the tenth does not, counted across both upload fields.
const minimaxH3R2vFull = createJobRequestMessage(
  'h3-r2v-full',
  { ...minimaxH3R2vParams, referenceImage: true, contextImages: Array(8).fill(true) },
  minimaxH3Options
);
assert.equal(minimaxH3R2vFull.keyFrames[0].hasContextImage9, true);
assert.equal(minimaxH3R2vFull.keyFrames[0].hasContextImage10, undefined);
assert.throws(
  () =>
    createJobRequestMessage(
      'h3-r2v-too-many',
      { ...minimaxH3R2vParams, referenceImage: true, contextImages: Array(9).fill(true) },
      minimaxH3Options
    ),
  /at most 9 uploaded reference images \(got 10\)/
);
assert.throws(
  () =>
    createJobRequestMessage(
      'h3-r2v-sparse',
      { ...minimaxH3R2vParams, contextImages: [true, undefined, true] },
      minimaxH3Options
    ),
  /contextImages must not contain empty entries/
);

// r2v runs on a Sogni worker, so every reference is an upload and receives a
// simple numbered slot.
const minimaxH3R2vUploaded = createJobRequestMessage(
  'h3-r2v-uploaded',
  {
    ...minimaxH3R2vParams,
    referenceImage: true,
    contextImages: [true],
    referenceVideo: true,
    referenceVideos: [true],
    referenceAudio: true,
    referenceAudios: [true]
  },
  minimaxH3Options
);
assert.equal(minimaxH3R2vUploaded.keyFrames[0].hasContextImage2, true);
assert.equal(minimaxH3R2vUploaded.keyFrames[0].hasReferenceVideo1, true);
assert.equal(minimaxH3R2vUploaded.keyFrames[0].hasReferenceVideo2, true);
assert.equal(minimaxH3R2vUploaded.keyFrames[0].hasReferenceVideo, undefined);
assert.equal(minimaxH3R2vUploaded.keyFrames[0].hasReferenceAudio1, true);
assert.equal(minimaxH3R2vUploaded.keyFrames[0].hasReferenceAudio2, true);
assert.equal(minimaxH3R2vUploaded.keyFrames[0].hasReferenceAudio, undefined);

// Eight images plus three uploaded slots of each media kind is 8+3+3,
// under every per-kind ceiling but over the 12-file total.
assert.throws(
  () =>
    createJobRequestMessage(
      'h3-r2v-total',
      {
        ...minimaxH3R2vParams,
        referenceImage: true,
        contextImages: Array(7).fill(true),
        referenceVideo: true,
        referenceVideos: [true, true],
        referenceAudio: true,
        referenceAudios: [true, true]
      },
      minimaxH3Options
    ),
  /at most 12 reference files in total \(got 14: 8 image, 3 video, 3 audio\)/
);
assert.throws(
  () =>
    createJobRequestMessage(
      'h3-r2v-too-many-videos',
      {
        ...minimaxH3R2vParams,
        referenceImage: true,
        referenceVideo: true,
        referenceVideos: [true, true, true]
      },
      minimaxH3Options
    ),
  /at most 3 uploaded reference videos \(got 4\)/
);

for (const field of ['referenceImageUrls', 'referenceVideoUrls', 'referenceAudioUrls']) {
  assert.throws(
    () =>
      createJobRequestMessage(
        `h3-r2v-${field}`,
        { ...minimaxH3R2vParams, referenceImage: true, [field]: ['https://example.com/ref'] },
        minimaxH3Options
      ),
    new RegExp(`MiniMax H3 r2v does not accept ${field}`)
  );
}

// r2v has no frame anchors, and referenceAudioIdentity shares referenceAudio's
// stored object, so both are rejected rather than uploaded and ignored.
for (const [asset, pattern] of [
  ['referenceImageEnd', /r2v workflow does not support referenceImageEnd/],
  ['referenceAudioIdentity', /r2v workflow does not support referenceAudioIdentity/]
]) {
  assert.throws(
    () =>
      createJobRequestMessage(
        `h3-r2v-${asset}`,
        { ...minimaxH3R2vParams, referenceImage: true, [asset]: true },
        minimaxH3Options
      ),
    pattern
  );
}

// The URL arrays stay closed to every other native video model.
assert.throws(
  () =>
    createJobRequestMessage(
      'h3-t2v-urls',
      { ...minimaxH3Params, referenceImageUrls: ['https://example.com/a.jpg'] },
      minimaxH3Options
    ),
  /supported only by Seedance and HappyHorse models/
);

// contextImages is the r2v transport and nothing else's.
for (const modelId of [
  minimaxH3ModelIds.t2v,
  minimaxH3ModelIds.i2v,
  PREFERRED_MODEL_IDS.video.happyhorseR2v
]) {
  assert.throws(
    () =>
      createJobRequestMessage(
        'h3-context-images-wrong-model',
        { ...minimaxH3Params, modelId, referenceImage: true, contextImages: [true] },
        minimaxH3Options
      ),
    /contextImages is supported only by the MiniMax H3 r2v workflow/
  );
}

// HappyHorse r2v is the only model in the fixture compatible with the r2v
// workflow, so a workflow-only selection must resolve to it.
assert.equal(
  selectBackboneModel(models, {
    mediaType: 'video',
    requestedModel: PREFERRED_MODEL_IDS.video.happyhorseR2v,
    workflows: ['r2v'],
    preferredModelIds: [PREFERRED_MODEL_IDS.video.happyhorseR2v]
  }).modelId,
  PREFERRED_MODEL_IDS.video.happyhorseR2v
);
assert.equal(
  selectBackboneModel(models, {
    mediaType: 'video',
    workflows: ['r2v']
  }).modelId,
  PREFERRED_MODEL_IDS.video.happyhorseR2v
);

assert.equal(serializeUnknownError(new Error('plain failure')), 'plain failure');
assert.equal(
  serializeUnknownError({ message: 'message field wins', code: 400 }),
  'message field wins'
);
assert.equal(serializeUnknownError({ error: { message: 'nested failure' } }), 'nested failure');
assert.equal(serializeUnknownError({ reason: 'reason fallback' }), 'reason fallback');
assert.equal(
  serializeUnknownError({ code: 4024, originalCode: 'INSUFFICIENT_CREDITS' }),
  '{"code":4024,"originalCode":"INSUFFICIENT_CREDITS"}'
);
const circular = { code: 'circular' };
circular.self = circular;
assert.equal(serializeUnknownError(circular), '{"code":"circular","self":"[Circular]"}');

assert.equal(isNonEmptyString('  x  '), true);
assert.equal(isNonEmptyString('   '), false);
assert.deepEqual(asStringArray(['a', '', ' b ', 3]), ['a', ' b ']);
assert.equal(asFiniteNumber(12.5), 12.5);
assert.equal(asFiniteNumber(Number.NaN), undefined);
assert.equal(asBooleanValue(false), false);
assert.equal(asBooleanValue('false'), undefined);
assert.equal(normalizeTimeSignature('7/8'), '7/8');
assert.equal(normalizeTimeSignature(3.8), '4');
assert.equal(normalizeVideoControlMode('depth'), 'depth');
assert.equal(normalizeVideoControlMode('seedance-v2v'), 'seedance-v2v');
assert.equal(normalizeVideoControlMode('unknown'), 'animate-move');
assert.equal(getHostedVariationCount({ numberOfVariations: 20 }), 16);
assert.equal(getHostedVariationCount({}, 4.2), 4);
assert.equal(
  validateCustomImageSize(3840, { modelId: 'gpt-image-2', propertyName: 'Width' }),
  3840
);
assert.equal(
  validateCustomImageSize(2560, { modelId: 'flux2_dev_fp8', propertyName: 'Width' }),
  2560
);
assert.equal(
  validateCustomImageSize(2048, {
    modelId: PREFERRED_MODEL_IDS.image.krea2IdentityEdit,
    propertyName: 'Width'
  }),
  2048
);
assert.equal(
  validateCustomImageSize(512, {
    modelId: PREFERRED_MODEL_IDS.image.krea2IdentityEdit,
    propertyName: 'Width'
  }),
  512
);
assert.throws(
  () => validateCustomImageSize(3841, { modelId: 'gpt-image-2', propertyName: 'Width' }),
  /Width must be less or equal 3840/
);
assert.throws(
  () =>
    validateCustomImageSize(2049, {
      modelId: PREFERRED_MODEL_IDS.image.darkBeastKrea2IdentityEdit,
      propertyName: 'Width'
    }),
  /Width must be less or equal 2048/
);
assert.throws(
  () =>
    validateCustomImageSize(511, {
      modelId: PREFERRED_MODEL_IDS.image.krea2IdentityEdit,
      propertyName: 'Width'
    }),
  /Width must greater or equal 512/
);
assert.equal(getMaxContextImages(PREFERRED_MODEL_IDS.image.krea2IdentityEdit), 2);
assert.equal(getMaxContextImages(PREFERRED_MODEL_IDS.image.darkBeastKrea2IdentityEdit), 2);
assert.equal(isComfyModel('dark_beast_krea2_fp8'), true);
assert.equal(isComfyModel(PREFERRED_MODEL_IDS.image.darkBeastKrea2IdentityEdit), true);
assert.throws(
  () =>
    validateCustomImageSize(2560, {
      modelId: 'coreml-albedobaseXL_v31Large',
      propertyName: 'Width'
    }),
  /Width must be less or equal 2048/
);
assert.equal(
  resolveHostedToolModelSelector('generate_image', { model: 'flux2' }),
  PREFERRED_MODEL_IDS.image.flux2
);
assert.equal(
  resolveHostedToolModelSelector('generate_image', { model: 'GPT-2' }),
  PREFERRED_MODEL_IDS.image.gptImage2
);
assert.equal(
  resolveHostedToolModelSelector('generate_image', { model: 'OpenAI' }),
  PREFERRED_MODEL_IDS.image.gptImage2
);
assert.equal(
  resolveHostedToolModelSelector('edit_image', { model: 'GPT-2' }),
  PREFERRED_MODEL_IDS.image.gptImage2
);
assert.equal(
  resolveHostedToolModelSelector('edit_image', { model: 'OpenAI image' }),
  PREFERRED_MODEL_IDS.image.gptImage2
);
assert.equal(
  resolveHostedToolModelSelector('edit_image', { model: 'krea identity edit' }),
  PREFERRED_MODEL_IDS.image.krea2IdentityEdit
);
assert.equal(
  resolveHostedToolModelSelector('edit_image', { model: 'krea-2-identity-edit-lora-v1-2' }),
  PREFERRED_MODEL_IDS.image.krea2IdentityEdit
);
assert.equal(
  resolveHostedToolModelSelector('edit_image', { model: 'dark beast krea2 identity edit' }),
  PREFERRED_MODEL_IDS.image.darkBeastKrea2IdentityEdit
);
assert.equal(isEditImageModel(PREFERRED_MODEL_IDS.image.krea2IdentityEdit), true);
assert.equal(isEditImageModel(PREFERRED_MODEL_IDS.image.darkBeastKrea2IdentityEdit), true);
assert.equal(
  resolveHostedToolModelSelector('generate_image', { model: 'future_live_model' }),
  'future_live_model'
);
assert.equal(
  resolveHostedToolModelSelector('generate_video', { videoModel: 'ltx23' }),
  PREFERRED_MODEL_IDS.video.t2v
);
assert.equal(
  resolveHostedToolModelSelector('generate_video', { videoModel: 'minimax-h3-t2v' }),
  PREFERRED_MODEL_IDS.video.minimaxH3T2v
);
assert.equal(
  resolveHostedToolModelSelector('animate_photo', { videoModel: 'minimax-h3-i2v' }),
  PREFERRED_MODEL_IDS.video.minimaxH3I2v
);
assert.equal(
  resolveHostedToolModelSelector('animate_photo', { videoModel: 'minimax-h3-flf2v' }),
  PREFERRED_MODEL_IDS.video.minimaxH3Flf2v
);
assert.equal(
  resolveHostedToolModelSelector('generate_video', {
    videoModel: 'ltx23',
    referenceImageIndices: [-1]
  }),
  PREFERRED_MODEL_IDS.video.i2v
);
assert.equal(
  resolveHostedToolModelSelector('generate_video', { videoModel: 'seedance2' }),
  PREFERRED_MODEL_IDS.video.seedanceT2v
);
assert.equal(
  resolveHostedToolModelSelector('generate_video', { videoModel: 'seedance2-mini' }),
  PREFERRED_MODEL_IDS.video.seedanceMiniT2v
);
assert.equal(
  resolveHostedToolModelSelector('generate_video', { videoModel: 'seedance2-fast' }),
  PREFERRED_MODEL_IDS.video.seedanceFastT2v
);
assert.equal(
  resolveHostedToolModelSelector('generate_video', {
    videoModel: 'seedance2',
    referenceImageIndices: [-1]
  }),
  PREFERRED_MODEL_IDS.video.seedanceI2v
);
assert.equal(
  resolveHostedToolModelSelector('generate_video', {
    videoModel: 'seedance2-mini',
    referenceImageIndices: [-1]
  }),
  PREFERRED_MODEL_IDS.video.seedanceMiniI2v
);
assert.equal(
  resolveHostedToolModelSelector('generate_video', {
    videoModel: 'seedance2-fast',
    referenceImageIndices: [-1]
  }),
  PREFERRED_MODEL_IDS.video.seedanceFastI2v
);
assert.equal(
  resolveHostedToolModelSelector('generate_video', { videoModel: 'happyhorse' }),
  PREFERRED_MODEL_IDS.video.happyhorseT2v
);
assert.equal(
  resolveHostedToolModelSelector('generate_video', { videoModel: 'happyhorse1.1' }),
  PREFERRED_MODEL_IDS.video.happyhorseT2v
);
assert.equal(
  resolveHostedToolModelSelector('generate_video', { videoModel: 'HappyHorse' }),
  PREFERRED_MODEL_IDS.video.happyhorseT2v
);
assert.equal(
  resolveHostedToolModelSelector('generate_video', {
    videoModel: 'happyhorse',
    referenceImageIndices: [-1]
  }),
  PREFERRED_MODEL_IDS.video.happyhorseI2v
);
assert.equal(
  resolveHostedToolModelSelector('generate_video', {
    videoModel: 'happyhorse1.1',
    referenceImageIndices: [-1]
  }),
  PREFERRED_MODEL_IDS.video.happyhorseI2v
);
assert.equal(
  resolveHostedToolModelSelector('video_to_video', { videoModel: 'seedance2' }),
  PREFERRED_MODEL_IDS.video.seedanceV2v
);
assert.equal(
  resolveHostedToolModelSelector('sound_to_video', { videoModel: 'wan-s2v' }),
  PREFERRED_MODEL_IDS.video.s2v
);
assert.equal(
  resolveHostedToolModelSelector('sound_to_video', { videoModel: 'seedance2' }),
  PREFERRED_MODEL_IDS.video.seedanceIa2v
);
assert.equal(
  resolveHostedToolModelSelector('sound_to_video', { videoModel: 'seedance2-mini' }),
  PREFERRED_MODEL_IDS.video.seedanceIa2v
);
assert.equal(
  resolveHostedToolModelSelector('generate_music', {
    model: PREFERRED_MODEL_IDS.audio.aceStepXlTurbo
  }),
  PREFERRED_MODEL_IDS.audio.aceStepXlTurbo
);
assert.deepEqual(
  validateHostedToolArguments(SogniTools.all, 'generate_music', {
    prompt: 'lo-fi beat',
    model: PREFERRED_MODEL_IDS.audio.aceStepXlTurbo
  }),
  { ok: true, errors: [] }
);
assert.deepEqual(
  validateHostedToolArguments(SogniTools.all, 'generate_music', {
    prompt: 'lo-fi beat',
    model: 'turbo'
  }),
  {
    ok: false,
    errors: [
      'Argument "model" must be one of "ace_step_1.5_xl_turbo", "ace_step_1.5_xl_sft", "ace_step_1.5_turbo", "ace_step_1.5_sft"'
    ]
  }
);
assert.equal(resolveHostedToolModelSelector('generate_image', {}), undefined);

// Generic validator surface checks — bound to canonical hosted creative-tool
// schemas mirrored from @sogni/creative-agent. Schema-specific validation
// behavior is covered by the canonical fixture parity check above; here we
// only verify that the validator itself accepts well-formed args and rejects
// non-object input across the surface.
assert.deepEqual(
  validateHostedToolArguments(SogniTools.all, 'generate_image', {
    prompt: 'cat'
  }),
  { ok: true, errors: [] }
);
assert.deepEqual(
  validateHostedToolArguments(SogniTools.all, 'generate_image', {
    prompt: 'cat',
    model: 'future_live_model'
  }),
  { ok: true, errors: [] }
);
assert.deepEqual(validateHostedToolArguments(SogniTools.all, 'generate_image', null), {
  ok: false,
  errors: ['Tool arguments must be a JSON object']
});
assert.throws(
  () => assertHostedToolArguments(SogniTools.all, 'generate_image', null),
  /Invalid generate_image arguments: Tool arguments must be a JSON object/
);

assert.deepEqual(
  parseCreativeWorkflowSseChunk(
    'id: 7\nevent: workflow_status\ndata: {"workflowId":"wf_1","status":"completed"}\n\n'
  ),
  [
    {
      id: '7',
      event: 'workflow_status',
      data: { workflowId: 'wf_1', status: 'completed' },
      raw: 'id: 7\nevent: workflow_status\ndata: {"workflowId":"wf_1","status":"completed"}'
    }
  ]
);

async function checkCanonicalDirectVideoExecution() {
  const tinyPng =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  let capturedParams;
  const projects = {
    waitForModels: async () => [
      { id: PREFERRED_MODEL_IDS.video.i2v, media: 'video', workerCount: 1 },
      { id: PREFERRED_MODEL_IDS.video.happyhorseR2v, media: 'video', workerCount: 1 }
    ],
    create: async (params) => {
      capturedParams = params;
      const project = new EventEmitter();
      project.id = 'project_direct_video_test';
      project.waitForCompletion = async () => ['https://cdn.sogni.ai/direct-video-test.mp4'];
      project.cancel = async () => {};
      return project;
    }
  };
  const api = new ChatToolsApi(projects);
  const toolCall = {
    id: 'call_direct_video_test',
    type: 'function',
    function: {
      name: 'generate_video',
      arguments: JSON.stringify({
        prompt: 'Animate this still frame.',
        videoModel: 'ltx23',
        referenceImageIndices: [-1],
        numberOfVariations: 3
      })
    }
  };

  const missingContext = await api.execute(toolCall);
  assert.equal(missingContext.success, false);
  assert.match(missingContext.error, /ToolExecutionOptions\.mediaContext/);
  assert.equal(capturedParams, undefined);

  const result = await api.execute(toolCall, {
    mediaContext: { uploadedImages: [tinyPng] }
  });
  assert.equal(result.success, true);
  assert.equal(capturedParams.modelId, PREFERRED_MODEL_IDS.video.i2v);
  assert.equal(capturedParams.numberOfMedia, 3);
  assert.ok(capturedParams.referenceImage instanceof Blob);

  const happyhorseCall = {
    ...toolCall,
    id: 'call_direct_happyhorse_test',
    function: {
      name: 'generate_video',
      arguments: JSON.stringify({
        prompt: 'Use both images as character references.',
        videoModel: 'happyhorse-1.1-r2v',
        referenceImageIndices: [-1, -2]
      })
    }
  };
  const happyhorseResult = await api.execute(happyhorseCall, {
    mediaContext: {
      uploadedImages: [
        'https://cdn.sogni.ai/reference-a.png',
        'https://cdn.sogni.ai/reference-b.png'
      ]
    }
  });
  assert.equal(happyhorseResult.success, true);
  assert.equal(capturedParams.modelId, PREFERRED_MODEL_IDS.video.happyhorseR2v);
  assert.deepEqual(capturedParams.referenceImageUrls, [
    'https://cdn.sogni.ai/reference-a.png',
    'https://cdn.sogni.ai/reference-b.png'
  ]);

  const invalidH3Call = {
    ...toolCall,
    id: 'call_direct_h3_reference_test',
    function: {
      name: 'generate_video',
      arguments: JSON.stringify({
        prompt: 'Animate this image.',
        videoModel: 'minimax-h3-t2v',
        referenceImageIndices: [-1]
      })
    }
  };
  const invalidH3Result = await api.execute(invalidH3Call, {
    mediaContext: { uploadedImages: [tinyPng] }
  });
  assert.equal(invalidH3Result.success, false);
  assert.match(invalidH3Result.error, /minimax-h3-t2v does not accept reference images/);
}

checkCanonicalDirectVideoExecution()
  .then(() => console.log('chat model routing parity checks passed'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
