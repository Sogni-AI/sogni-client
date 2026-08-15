/**
 * Regression checks for server-advertised video model geometry.
 * Runs against compiled `dist/` output to verify the public SDK mapping.
 */

'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const ProjectsApi = require('../dist/Projects/index.js').default;

const MODEL_ID = 'minimax-h3-fl2va-fp8_t2v';
const TIER_ID = 'minimax-h3-fl2va-fp8_t2v';
const SILENT_LOGGER = { info() {}, warn() {}, error() {}, debug() {} };

class SocketStub extends EventEmitter {
  async get(path) {
    if (path === '/api/v1/models/list') {
      return [{ id: MODEL_ID, name: 'MiniMax H3 T2V', SID: 1, tier: TIER_ID, media: 'video' }];
    }
    if (path === '/api/v2/models/tiers') {
      return {
        [TIER_ID]: {
          type: 'video',
          benchmark: { sec: 1, secCN: 0, secMaxPreviews: 0 },
          width: { min: 544, max: 1344, step: 32, default: 1344 },
          height: { min: 544, max: 1344, step: 32, default: 768 },
          maxPixels: 1_032_192,
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
  const options = await projects.getModelOptions(MODEL_ID);

  assert.equal(options.type, 'video');
  assert.deepEqual(options.width, { min: 544, max: 1344, step: 32, default: 1344 });
  assert.deepEqual(options.height, { min: 544, max: 1344, step: 32, default: 768 });
  assert.equal(options.maxPixels, 1_032_192);
  assert.deepEqual(options.sampler, { allowed: ['euler'], default: 'euler' });
  assert.deepEqual(options.scheduler, { allowed: ['simple'], default: 'simple' });

  console.log('Video model option checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
