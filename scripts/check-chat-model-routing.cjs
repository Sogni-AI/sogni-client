const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
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
  isEditImageModel,
  isNonEmptyString,
  normalizeTimeSignature,
  normalizeVideoControlMode,
  resolveHostedToolModelSelector,
  selectBackboneModel,
  serializeUnknownError,
  validateHostedToolArguments
} = require('../dist/Chat/modelRouting.js');
const { SogniTools } = require('../dist/Chat/tools.js');

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
  return createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex');
}

const sdkHostedToolsByName = new Map(SogniTools.all.map((tool) => [tool.function.name, tool]));

assert.deepEqual(
  hostedAliasParityVector.tools.map((tool) => tool.hostedToolName),
  SogniTools.all.map((tool) => tool.function.name)
);

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
  { id: 'flux2_dev_fp8', media: 'image', workerCount: 1 },
  { id: PREFERRED_MODEL_IDS.video.t2v, media: 'video', workerCount: 1 },
  { id: 'wan_v2.2-14b-fp8_t2v_lightx2v', media: 'video', workerCount: 20 },
  { id: PREFERRED_MODEL_IDS.video.i2v, media: 'video', workerCount: 4 },
  { id: PREFERRED_MODEL_IDS.video.ia2v, media: 'video', workerCount: 3 },
  { id: PREFERRED_MODEL_IDS.video.s2v, media: 'video', workerCount: 9 },
  { id: PREFERRED_MODEL_IDS.video.animateMove, media: 'video', workerCount: 6 },
  { id: PREFERRED_MODEL_IDS.video.v2v, media: 'video', workerCount: 2 },
  { id: PREFERRED_MODEL_IDS.audio.aceStepTurbo, media: 'audio', workerCount: 1 },
  { id: PREFERRED_MODEL_IDS.audio.aceStepSft, media: 'audio', workerCount: 10 }
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
    preferredModelIds: [PREFERRED_MODEL_IDS.audio.aceStepTurbo, PREFERRED_MODEL_IDS.audio.aceStepSft]
  }).modelId,
  PREFERRED_MODEL_IDS.audio.aceStepTurbo
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

assert.equal(serializeUnknownError(new Error('plain failure')), 'plain failure');
assert.equal(serializeUnknownError({ message: 'message field wins', code: 400 }), 'message field wins');
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
assert.equal(normalizeVideoControlMode('unknown'), 'animate-move');
assert.equal(getHostedVariationCount({ number_of_variations: 20 }), 16);
assert.equal(getHostedVariationCount({}, 4.2), 4);
assert.equal(
  resolveHostedToolModelSelector('sogni_generate_image', { model: 'flux2' }),
  PREFERRED_MODEL_IDS.image.flux2
);
assert.equal(
  resolveHostedToolModelSelector('sogni_generate_image', { model: 'future_live_model' }),
  'future_live_model'
);
assert.equal(
  resolveHostedToolModelSelector('sogni_generate_video', { model: 'ltx23' }),
  PREFERRED_MODEL_IDS.video.t2v
);
assert.equal(
  resolveHostedToolModelSelector('sogni_generate_video', {
    model: 'ltx23',
    reference_image_url: 'data:image/png;base64,aaa'
  }),
  PREFERRED_MODEL_IDS.video.i2v
);
assert.equal(
  resolveHostedToolModelSelector('sogni_sound_to_video', { model: 'wan-s2v' }),
  PREFERRED_MODEL_IDS.video.s2v
);
assert.equal(
  resolveHostedToolModelSelector('sogni_generate_music', { model: 'turbo' }),
  PREFERRED_MODEL_IDS.audio.aceStepTurbo
);
assert.equal(resolveHostedToolModelSelector('sogni_generate_image', {}), undefined);

assert.deepEqual(
  validateHostedToolArguments(SogniTools.all, 'sogni_generate_image', {
    prompt: 'cat',
    width: 1024,
    model: 'future_live_model'
  }),
  { ok: true, errors: [] }
);
assert.deepEqual(
  validateHostedToolArguments(SogniTools.all, 'sogni_generate_image', null),
  { ok: false, errors: ['Tool arguments must be a JSON object'] }
);
assert.deepEqual(
  validateHostedToolArguments(SogniTools.all, 'sogni_sound_to_video', { prompt: 'music video' }),
  { ok: false, errors: ['Missing required argument "reference_audio_url"'] }
);
assert.deepEqual(
  validateHostedToolArguments(SogniTools.all, 'sogni_edit_image', {
    prompt: 'edit',
    reference_image_urls: ['data:image/png;base64,aaa', 123]
  }),
  { ok: false, errors: ['Argument "reference_image_urls[1]" must be string'] }
);
assert.deepEqual(
  validateHostedToolArguments(SogniTools.all, 'sogni_video_to_video', {
    prompt: 'restyle',
    reference_video_url: 'data:video/mp4;base64,aaa',
    control_mode: 'invalid'
  }),
  {
    ok: false,
    errors: ['Argument "control_mode" must be one of "animate-move", "animate-replace", "canny", "pose", "depth", "detailer"']
  }
);
assert.throws(
  () => assertHostedToolArguments(SogniTools.all, 'sogni_generate_music', {
    prompt: 'song',
    composer_mode: 'true'
  }),
  /Invalid sogni_generate_music arguments: Argument "composer_mode" must be boolean/
);

console.log('chat model routing parity checks passed');
