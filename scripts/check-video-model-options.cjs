/**
 * Regression checks for server-advertised model options.
 * Runs against compiled `dist/` output to verify the public SDK mapping.
 */

'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const ProjectsApi = require('../dist/Projects/index.js').default;

const VIDEO_MODEL_ID = 'minimax-h3-fl2va-fp8_t2v';
const VIDEO_TIER_ID = 'minimax-h3-fl2va-fp8_t2v';
const UPSCALE_MODEL_ID = 'rtx_vsr_pro';
const UPSCALE_TIER_ID = 'rtx_vsr_pro';
const MUSIC_MODEL_ID = 'minimax_music3';
const MUSIC_TIER_ID = 'minimax_music3';
const SILENT_LOGGER = { info() {}, warn() {}, error() {}, debug() {} };

class SocketStub extends EventEmitter {
  async get(path) {
    if (path === '/api/v1/models/list') {
      return [
        { id: VIDEO_MODEL_ID, name: 'MiniMax H3 T2V', SID: 1, tier: VIDEO_TIER_ID, media: 'video' },
        { id: UPSCALE_MODEL_ID, name: 'RTX VSR Pro', SID: 2, tier: UPSCALE_TIER_ID, media: 'image' },
        { id: MUSIC_MODEL_ID, name: 'MiniMax Music 3', SID: 3, tier: MUSIC_TIER_ID, media: 'audio' }
      ];
    }
    if (path === '/api/v2/models/tiers') {
      return {
        [VIDEO_TIER_ID]: {
          type: 'video',
          benchmark: { sec: 1, secCN: 0, secMaxPreviews: 0 },
          width: { min: 544, max: 1344, step: 32, default: 1344 },
          height: { min: 544, max: 1344, step: 32, default: 768 },
          maxPixels: 1_032_192,
          comfySampler: { allowed: ['euler'], default: 'euler' },
          comfyScheduler: { allowed: ['simple'], default: 'simple' }
        },
        [UPSCALE_TIER_ID]: {
          type: 'image',
          benchmark: { sec: 1, secCN: 0, secMaxPreviews: 0 },
          defaultSize: 2048,
          steps: { min: 1, max: 1, default: 1 },
          comfyScheduler: { allowed: [], default: '' }
        },
        [MUSIC_TIER_ID]: {
          type: 'audio',
          benchmark: { sec: 1, secCN: 0, secMaxPreviews: 0 },
          steps: { min: 10, max: 100, default: 30 },
          guidance: { min: 1, max: 5, decimals: 1, default: 1.7 },
          duration: { min: 10, max: 300, default: 60 },
          comfySampler: { allowed: ['euler'], default: 'euler' },
          comfyScheduler: { allowed: ['simple'], default: 'simple' }
        }
      };
    }
    throw new Error(`Unexpected socket GET ${path}`);
  }
}

class ClientStub extends EventEmitter {
  constructor() {
    super();
    this.socket = new SocketStub();
    this.logger = SILENT_LOGGER;
  }
}

async function main() {
  const projects = new ProjectsApi({ client: new ClientStub(), eip712: {} });
  const options = await projects.getModelOptions(VIDEO_MODEL_ID);

  assert.equal(options.type, 'video');
  assert.deepEqual(options.width, { min: 544, max: 1344, step: 32, default: 1344 });
  assert.deepEqual(options.height, { min: 544, max: 1344, step: 32, default: 768 });
  assert.equal(options.maxPixels, 1_032_192);
  assert.deepEqual(options.sampler, { allowed: ['euler'], default: 'euler' });
  assert.deepEqual(options.scheduler, { allowed: ['simple'], default: 'simple' });

  const upscaleOptions = await projects.getModelOptions(UPSCALE_MODEL_ID);

  assert.equal(upscaleOptions.type, 'image');
  assert.equal(Object.hasOwn(upscaleOptions, 'guidance'), false);
  assert.deepEqual(upscaleOptions.sampler, { allowed: [], default: null });
  assert.deepEqual(upscaleOptions.scheduler, { allowed: [], default: '' });

  const musicOptions = await projects.getModelOptions(MUSIC_MODEL_ID);

  assert.equal(musicOptions.type, 'audio');
  assert.deepEqual(musicOptions.steps, { min: 10, max: 100, step: 1, default: 30 });
  assert.deepEqual(musicOptions.guidance, { min: 1, max: 5, step: 0.1, default: 1.7 });
  assert.deepEqual(musicOptions.duration, { min: 10, max: 300, step: 1, default: 60 });
  assert.equal(Object.hasOwn(musicOptions, 'bpm'), false);
  assert.equal(Object.hasOwn(musicOptions, 'timesignature'), false);
  assert.equal(Object.hasOwn(musicOptions, 'language'), false);

  console.log('Model option checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
