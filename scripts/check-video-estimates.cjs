/**
 * Regression checks for estimate-only video request metadata.
 * Runs against compiled output so it also checks the published API shape.
 */

'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const ProjectsApi = require('../dist/Projects/index.js').default;

class SocketStub extends EventEmitter {
  constructor() {
    super();
    this.paths = [];
  }

  async get(path) {
    this.paths.push(path);
    return {
      quote: {
        project: {
          costInToken: '1',
          costInUSD: '0.01',
          costInSpark: '2',
          costInSogni: '3'
        }
      }
    };
  }
}

class ClientStub extends EventEmitter {
  constructor() {
    super();
    this.socket = new SocketStub();
    this.logger = { info() {}, warn() {}, error() {}, debug() {} };
  }
}

async function estimate(projects, overrides = {}) {
  return projects.estimateVideoCost({
    tokenType: 'spark',
    model: 'minimax-h3-ref2va-fp8_r2v',
    width: 1344,
    height: 768,
    duration: 6,
    fps: 24,
    steps: 20,
    numberOfMedia: 1,
    ...overrides
  });
}

async function main() {
  const client = new ClientStub();
  const projects = new ProjectsApi({ client, eip712: {} });

  await estimate(projects);
  assert.equal(
    client.socket.paths.at(-1),
    '/api/v1/job-video/estimate/spark/minimax-h3-ref2va-fp8_r2v/1344/768/141/24/20/1',
    'omitting the additive field must preserve the legacy request exactly'
  );

  await estimate(projects, {
    model: 'minimax-h3-ref2va-fp8_r2v_balanced',
    steps: 8
  });
  assert.equal(
    client.socket.paths.at(-1),
    '/api/v1/job-video/estimate/spark/minimax-h3-ref2va-fp8_r2v_balanced/1344/768/141/24/8/1',
    'Balanced pricing must be requested from the server with its exact model id and fixed step count'
  );

  await estimate(projects, { referenceImageCount: 6 });
  assert.equal(
    new URL(`https://socket.test${client.socket.paths.at(-1)}`).searchParams.get(
      'referenceImageCount'
    ),
    '6',
    'the actual reference image count must reach the estimate endpoint'
  );

  await estimate(projects, {
    referenceVideoCount: 2,
    referenceVideoDurationSeconds: 13.5
  });
  const h3VideoInput = new URL(`https://socket.test${client.socket.paths.at(-1)}`).searchParams;
  assert.equal(h3VideoInput.get('referenceVideoCount'), '2');
  assert.equal(h3VideoInput.get('referenceVideoDurationSeconds'), '13.5');

  await estimate(projects, {
    model: 'seedance-2-0',
    hasVideoInput: true,
    referenceImageCount: 5.9
  });
  const combined = new URL(`https://socket.test${client.socket.paths.at(-1)}`).searchParams;
  assert.equal(combined.get('hasVideoInput'), '1');
  assert.equal(combined.get('referenceImageCount'), '5');

  await estimate(projects, { referenceImageCount: Number.NaN });
  assert.equal(
    new URL(`https://socket.test${client.socket.paths.at(-1)}`).searchParams.has(
      'referenceImageCount'
    ),
    false,
    'invalid optional metadata must not corrupt a backwards-compatible estimate'
  );

  console.log('Video estimate request checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
