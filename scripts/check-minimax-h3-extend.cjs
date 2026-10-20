'use strict';
/**
 * MiniMax H3 video extension: a text-to-video job that carries `referenceVideo`
 * continues that video from its last 22 frames and their audio. Runs against
 * compiled output so it also checks the published API shape.
 *
 * - FastH3 text-to-video accepts an optional referenceVideo and every other
 *   entry of its table matches generic t2v; the other H3 t2v tiers and the
 *   two-stage id (not offered yet), non-H3 t2v models and other H3 workflows
 *   still forbid one;
 * - the source rides as the unnumbered referenceVideo upload with
 *   hasReferenceVideo (the flag sogni-socket reads as an extension), and a job
 *   without one is unchanged;
 * - external video URLs stay refused, because the worker needs a Sogni upload;
 * - estimateVideoCost sends hasVideoInput=1 with the source, so the quote
 *   prices the extension the job is charged for.
 */
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const createJobRequestMessage = require('../dist/Projects/createJobRequestMessage.js').default;
const {
  getVideoAssetRequirements,
  isMinimaxH3ExtendModel,
  MINIMAX_H3_T2V_ASSETS,
  VIDEO_WORKFLOW_ASSETS
} = require('../dist/Projects/utils/index.js');
const ProjectsApi = require('../dist/Projects/index.js').default;

const EXTEND_ID = 'minimax-h3-fastvideo-int8_t2v_turbo';
const NOT_YET_IDS = [
  'minimax-h3-fl2va-fp8_t2v',
  'minimax-h3-fl2va-fp8_t2v_turbo',
  'minimax-h3-fl2va-fp8_t2v_balanced',
  'minimax-h3-fastvideo-int8_t2v_turbo_2stage'
];
const options = {
  type: 'video',
  steps: { min: 4, max: 4, step: 1, default: 4 },
  guidance: { min: 1, max: 1, step: 1, default: 1 },
  fps: { allowed: [24], default: 24 },
  sampler: { allowed: [], default: null },
  scheduler: { allowed: ['simple'], default: 'simple' }
};
const params = (overrides = {}) => ({
  type: 'video',
  modelId: 'minimax-h3-fastvideo-int8_t2v_turbo',
  numberOfMedia: 1,
  positivePrompt: 'The vendor laughs and hands her the bowl.',
  frames: 141,
  width: 1344,
  height: 768,
  steps: 4,
  guidance: 1,
  scheduler: 'simple',
  ...overrides
});
const keyFrame = (overrides) => createJobRequestMessage('h3-extend', params(overrides), options).keyFrames[0];

assert.equal(isMinimaxH3ExtendModel(EXTEND_ID), true);
assert.equal(getVideoAssetRequirements(EXTEND_ID), MINIMAX_H3_T2V_ASSETS, 'FastH3 t2v uses the extension table');
for (const modelId of NOT_YET_IDS) {
  assert.equal(isMinimaxH3ExtendModel(modelId), false, `${modelId} does not extend yet`);
  assert.equal(getVideoAssetRequirements(modelId).referenceVideo, 'forbidden', `${modelId} still forbids a video`);
  assert.throws(() => keyFrame({ modelId, referenceVideo: Buffer.from('v') }), /referenceVideo/, `${modelId} refuses a source`);
}
assert.deepEqual(
  { ...MINIMAX_H3_T2V_ASSETS, referenceVideo: VIDEO_WORKFLOW_ASSETS.t2v.referenceVideo },
  VIDEO_WORKFLOW_ASSETS.t2v,
  'only referenceVideo differs from generic t2v'
);
assert.equal(MINIMAX_H3_T2V_ASSETS.referenceVideo, 'optional');
assert.equal(VIDEO_WORKFLOW_ASSETS.t2v.referenceVideo, 'forbidden', 'generic t2v still forbids a video');
assert.equal(getVideoAssetRequirements('wan_v2.2-14b-fp8_t2v').referenceVideo, 'forbidden');
for (const modelId of ['minimax-h3-fastvideo-int8_i2v_turbo', 'minimax-h3-fl2va-fp8_flf2v']) {
  assert.equal(getVideoAssetRequirements(modelId).referenceVideo, 'forbidden', `${modelId} forbids a video`);
}

// The source rides as the unnumbered referenceVideo upload.
const source = Buffer.from('source video');
const extended = keyFrame({ referenceVideo: source });
assert.equal(extended.hasReferenceVideo, true);
assert.deepEqual(Object.keys(extended).filter((key) => /^hasReferenceVideo\d/.test(key)), []);
assert.equal(extended.frames, 141, 'the job renders the full frame count; the worker trims the pinned head');
const plain = keyFrame({});
assert.equal(plain.hasReferenceVideo, undefined, 'without a source it is ordinary text-to-video');
assert.throws(
  () => keyFrame({ referenceVideoUrls: ['https://example.com/source.mp4'] }),
  { message: 'External reference URLs are supported only by Seedance, HappyHorse, and Wan 3 models.' }
);
assert.throws(
  () => keyFrame({ modelId: 'minimax-h3-fastvideo-int8_i2v_turbo', referenceImage: source, referenceVideo: source }),
  /i2v workflow does not support referenceVideo|referenceVideo/
);

// The estimate carries the flag the socket prices the extension on.
class SocketStub extends EventEmitter {
  constructor() {
    super();
    this.paths = [];
  }
  async get(path) {
    this.paths.push(path);
    const cost = { costInToken: '1', costInUSD: '0.01', costInSpark: '2', costInSogni: '3', costInRenderSec: '8' };
    return { quote: { job: cost, project: cost } };
  }
}
class ClientStub extends EventEmitter {
  constructor() {
    super();
    this.socket = new SocketStub();
    this.logger = { info() {}, warn() {}, error() {}, debug() {} };
  }
}

async function main() {
  const client = new ClientStub();
  const projects = new ProjectsApi({ client, eip712: {} });
  const estimate = (overrides) =>
    projects.estimateVideoCost({
      tokenType: 'spark',
      model: 'minimax-h3-fastvideo-int8_t2v_turbo',
      width: 1344,
      height: 768,
      frames: 141,
      fps: 24,
      steps: 4,
      numberOfMedia: 1,
      ...overrides
    });
  await estimate({ referenceVideo: source });
  const query = new URL(`https://socket.test${client.socket.paths.at(-1)}`).searchParams;
  assert.equal(query.get('hasVideoInput'), '1', 'an extension quote carries hasVideoInput');
  await estimate({});
  assert.equal(
    client.socket.paths.at(-1),
    '/api/v1/job-video/estimate/spark/minimax-h3-fastvideo-int8_t2v_turbo/1344/768/141/24/4/1',
    'a plain text-to-video quote is unchanged'
  );
  console.log('minimax-h3 extend: ok');
}
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
