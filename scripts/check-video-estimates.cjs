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
        job: {
          costInToken: '1',
          costInUSD: '0.01',
          costInSpark: '2',
          costInSogni: '3',
          costInRenderSec: '8'
        },
        project: {
          costInToken: '1',
          costInUSD: '0.01',
          costInSpark: '2',
          costInSogni: '3',
          costInRenderSec: '8'
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

  // MiniMax H3 two-stage output is priced by its own model id on the canvas the
  // job renders (768p for 2K, a 544 short edge for 1080p, a 384 short edge for
  // 720p); nothing rides the query.
  await estimate(projects, { model: 'minimax-h3-fastvideo-int8_t2v_turbo_2stage', steps: 4 });
  assert.equal(
    client.socket.paths.at(-1),
    '/api/v1/job-video/estimate/spark/minimax-h3-fastvideo-int8_t2v_turbo_2stage/1344/768/141/24/4/1',
    '2K pricing must be requested with the two-stage model id and the 768p canvas'
  );
  await estimate(projects, {
    model: 'minimax-h3-fastvideo-int8_i2v_turbo_2stage',
    width: 960,
    height: 544,
    steps: 4
  });
  assert.equal(
    client.socket.paths.at(-1),
    '/api/v1/job-video/estimate/spark/minimax-h3-fastvideo-int8_i2v_turbo_2stage/960/544/141/24/4/1',
    '1080p pricing must be requested with the two-stage model id and the 544 canvas'
  );
  await estimate(projects, {
    model: 'minimax-h3-fastvideo-int8_flf2v_turbo_2stage',
    width: 672,
    height: 384,
    steps: 4
  });
  assert.equal(
    client.socket.paths.at(-1),
    '/api/v1/job-video/estimate/spark/minimax-h3-fastvideo-int8_flf2v_turbo_2stage/672/384/141/24/4/1',
    '720p pricing must be requested with the two-stage model id and the 384 canvas'
  );
  // Two-stage reference-to-video is priced the same way: its own id on the
  // canvas the job renders, at its tier's own step count.
  await estimate(projects, {
    model: 'minimax-h3-ref2va-fp8_r2v_2stage',
    width: 960,
    height: 544,
    steps: 20
  });
  assert.equal(
    client.socket.paths.at(-1),
    '/api/v1/job-video/estimate/spark/minimax-h3-ref2va-fp8_r2v_2stage/960/544/141/24/20/1',
    '1080p Standard R2V two-stage pricing must be requested with the two-stage model id and the 544 canvas'
  );
  await estimate(projects, { model: 'minimax-h3-ref2va-fp8_r2v_balanced_2stage', steps: 8 });
  assert.equal(
    client.socket.paths.at(-1),
    '/api/v1/job-video/estimate/spark/minimax-h3-ref2va-fp8_r2v_balanced_2stage/1344/768/141/24/8/1',
    '2K Balanced R2V two-stage pricing must be requested with the two-stage model id and the 768p canvas'
  );
  // outputScale is retired: an untyped caller that still passes it (any value)
  // is refused with the socket's wording before any estimate request is made.
  const requestsBefore = client.socket.paths.length;
  for (const outputScale of [2, 1, null]) {
    await assert.rejects(
      estimate(projects, { model: 'minimax-h3-fastvideo-int8_t2v_turbo', steps: 4, outputScale }),
      (error) =>
        error.status === 400 &&
        error.message ===
          'outputScale is no longer supported. For MiniMax H3 1080p or 2K output use the two-stage model ids minimax-h3-fastvideo-int8_t2v_turbo_2stage, minimax-h3-fastvideo-int8_i2v_turbo_2stage or minimax-h3-fastvideo-int8_flf2v_turbo_2stage.'
    );
  }
  assert.equal(client.socket.paths.length, requestsBefore, 'a retired outputScale sends no request');

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
