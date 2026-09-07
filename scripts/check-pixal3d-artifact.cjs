'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const createJobRequestMessage = require('../dist/Projects/createJobRequestMessage.js').default;
const ProjectsApi = require('../dist/Projects/index.js').default;

const MODEL_ID = 'pixal3d_int8_i23d';
const MODEL_OPTIONS = {
  type: 'image',
  steps: { min: 56, max: 56, step: 1, default: 56 },
  guidance: { min: 0, max: 1, step: 0.1, default: 0 },
  sampler: { allowed: [], default: null },
  scheduler: { allowed: [], default: null }
};

function params(overrides = {}) {
  return {
    type: 'image',
    modelId: MODEL_ID,
    positivePrompt: 'the red ceramic teapot',
    numberOfMedia: 1,
    startingImage: true,
    ...overrides
  };
}

class SocketStub extends EventEmitter {
  constructor() {
    super();
    this.sent = [];
  }

  async send(type, data) {
    this.sent.push({ type, data });
  }
}

class ClientStub extends EventEmitter {
  constructor() {
    super();
    this.socket = new SocketStub();
    this.logger = { debug() {}, info() {}, warn() {}, error() {} };
  }

  resolveWorkloadAttribution() {
    return undefined;
  }
}

async function main() {
  const request = createJobRequestMessage('pixal3d-wire-test', params(), MODEL_OPTIONS);
  assert.equal(request.outputFormat, 'glb');
  assert.equal(request.keyFrames[0].hasStartingImage, true);
  assert.equal(request.keyFrames[0].positivePrompt, 'the red ceramic teapot');
  assert.throws(
    () => createJobRequestMessage('missing-source', params({ startingImage: undefined }), MODEL_OPTIONS),
    /requires startingImage/
  );

  const client = new ClientStub();
  const projects = new ProjectsApi({ client, eip712: {} });
  projects.getModelOptions = async () => MODEL_OPTIONS;
  const mediaCalls = [];
  projects.mediaDownloadUrl = async (input) => {
    mediaCalls.push(input);
    return 'https://cdn.example.test/object.glb';
  };
  projects.downloadUrl = async () => {
    throw new Error('Pixal3D must not use the image endpoint');
  };

  const project = await projects.create(params());
  client.socket.emit('jobState', {
    type: 'jobStarted',
    jobID: project.id,
    imgID: 'model-result-1',
    workerName: 'pixal3d-test-worker'
  });
  client.socket.emit('jobResult', {
    jobID: project.id,
    imgID: 'model-result-1',
    performedStepCount: 56,
    lastSeed: '42',
    triggeredNSFWFilter: false,
    userCanceled: false
  });
  await new Promise((resolve) => setImmediate(resolve));

  const job = project.job('model-result-1');
  assert.equal(job.type, 'model');
  assert.equal(job.resultUrl, 'https://cdn.example.test/object.glb');
  await assert.rejects(() => job.enhance(0.5), /only available for images/);
  assert.deepEqual(mediaCalls, [{
    jobId: project.id,
    id: 'model-result-1',
    type: 'complete',
    contentType: 'model/gltf-binary'
  }]);
  project._update({ status: 'failed', error: { code: 0, message: 'test cleanup' } });

  console.log('Pixal3D SDK artifact checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
