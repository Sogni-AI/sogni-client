// Reference files handed to the SDK as Node Buffers are typed by their bytes
// before upload (src/Projects/utils/fileContentType.ts). The declared type is
// what lets the socket keep audio guides the Mac app cannot decode (OGG, WebM)
// off Mac app workers, so every container the web app already accepts for an
// audio guide (audio/mpeg, audio/mp4, audio/wav, audio/webm, audio/ogg, plus
// FLAC) must be declared, and a WebM/Ogg buffer must be typed by the slot it
// fills.
const assert = require('node:assert/strict');

const { getFileContentType } = require('../dist/Projects/utils/fileContentType.js');

const pad = (bytes) => Buffer.concat([Buffer.from(bytes), Buffer.alloc(16)]);
const ascii = (text) => Array.from(Buffer.from(text, 'ascii'));

const cases = [
  ['FLAC', pad(ascii('fLaC')), 'audio', 'audio/flac'],
  ['FLAC, slot unknown', pad(ascii('fLaC')), undefined, 'audio/flac'],
  ['Ogg audio', pad(ascii('OggS')), 'audio', 'audio/ogg'],
  ['Ogg, slot unknown', pad(ascii('OggS')), undefined, 'audio/ogg'],
  ['Ogg video', pad(ascii('OggS')), 'video', 'video/ogg'],
  ['WebM audio', pad([0x1a, 0x45, 0xdf, 0xa3]), 'audio', 'audio/webm'],
  ['WebM video', pad([0x1a, 0x45, 0xdf, 0xa3]), 'video', 'video/webm'],
  ['WebM, slot unknown', pad([0x1a, 0x45, 0xdf, 0xa3]), undefined, 'video/webm'],
  ['WAV', pad([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WAVE')]), 'audio', 'audio/wav'],
  ['MP3 with ID3', pad(ascii('ID3')), 'audio', 'audio/mpeg'],
  ['MP3 frame sync', pad([0xff, 0xfb]), 'audio', 'audio/mpeg'],
  ['M4A', pad([0, 0, 0, 0x20, ...ascii('ftypM4A ')]), 'audio', 'audio/mp4'],
  ['MP4 video', pad([0, 0, 0, 0x20, ...ascii('ftypisom')]), 'video', 'video/mp4'],
  ['PNG', pad([0x89, 0x50, 0x4e, 0x47]), undefined, 'image/png'],
  ['unknown bytes', pad(ascii('nope')), 'audio', undefined]
];

for (const [name, buffer, slot, expected] of cases) {
  assert.equal(getFileContentType(buffer, slot), expected, `${name} should be ${expected}`);
}

// A browser File/Blob keeps its own type whatever the slot says.
if (typeof Blob !== 'undefined') {
  assert.equal(getFileContentType(new Blob(['x'], { type: 'audio/ogg' }), 'video'), 'audio/ogg');
}

console.log(`Reference content-type checks passed (${cases.length} buffers)`);
