'use strict';
const assert = require('node:assert/strict');
const create = require('../dist/Projects/createJobRequestMessage.js').default;
const { mapAudioTier } = require('../dist/Projects/types/ModelOptions.js');
const params = {
  type: 'audio',
  modelId: 'qwen3_tts_1.7b_voice_clone_bf16',
  numberOfMedia: 1,
  positivePrompt: 'Good evening. The rain has finally stopped.',
  referenceAudio: new Blob(['audio'], { type: 'audio/wav' }),
  referenceText: 'These are the words in the reference.'
};
const frame = (changes = {}) => create('qwen-clone', { ...params, ...changes }, { type: 'audio' }).keyFrames[0];
const original = frame();
assert.equal('fullText' in original, false);
assert.equal('creativity' in original, false);
assert.equal(original.referenceText, params.referenceText);
assert.equal(original.hasReferenceAudio, true);
for (const fullText of [true, false]) {
  const result = frame({ fullText, creativity: 0.6 });
  assert.equal(result.fullText, fullText);
  assert.equal(result.creativity, 0.6);
}
const tier = { type: 'audio', steps: { min: 1, max: 1, default: 1 } };
assert.deepEqual(mapAudioTier({ ...tier, fullText: { default: false } }).fullText, { default: false });
assert.equal(mapAudioTier(tier).fullText, undefined);
console.log('Qwen3-TTS transport and capabilities: PASS (omitted, true, false, transcript, variation)');
