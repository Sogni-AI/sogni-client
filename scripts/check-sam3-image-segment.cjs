'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const createJobRequestMessage = require('../dist/Projects/createJobRequestMessage.js').default;
const ProjectsApi = require('../dist/Projects/index.js').default;

const MODEL_ID = 'sam3_image_segment_bf16';
const MODEL_OPTIONS = {
  type: 'image',
  steps: { min: 1, max: 1, step: 1, default: 1 },
  guidance: { min: 0, max: 1, step: 0.1, default: 0 },
  sampler: { allowed: [], default: null },
  scheduler: { allowed: [], default: null }
};

function params(overrides = {}) {
  return {
    type: 'image',
    modelId: MODEL_ID,
    positivePrompt: '',
    numberOfMedia: 4,
    numberOfPreviews: 5,
    outputFormat: 'jpg',
    startingImage: true,
    sam3Prompt: {
      points: [{ x: 0.42, y: 0.61, label: 'positive' }]
    },
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
    this.appSource = 'sogni-world';
    this.logger = { debug() {}, info() {}, warn() {}, error() {} };
  }

  resolveWorkloadAttribution() {
    return undefined;
  }
}

async function main() {
  const request = createJobRequestMessage('sam3-wire-test', params(), MODEL_OPTIONS);
  assert.equal(request.numberOfImages, 1);
  assert.equal(request.previews, 0);
  assert.equal(request.outputFormat, 'png');
  assert.equal(request.keyFrames[0].hasStartingImage, true);
  assert.deepEqual(request.keyFrames[0].sam3Prompt, {
    points: [{ x: 0.42, y: 0.61, label: 'positive' }],
    boxes: [],
    threshold: 0.5,
    multimask: true
  });

  assert.throws(
    () => createJobRequestMessage('missing-source', params({ startingImage: undefined }), MODEL_OPTIONS),
    /requires startingImage/
  );
  assert.throws(
    () => createJobRequestMessage('wrong-model', params({ modelId: 'krea2_turbo_fp8_scaled' }), MODEL_OPTIONS),
    /only supported by sam3_image_segment_bf16/
  );

  const client = new ClientStub();
  const projects = new ProjectsApi({ client, eip712: {} });
  projects.getModelOptions = async () => MODEL_OPTIONS;
  const project = await projects.create(params());
  assert.equal(project.params.numberOfMedia, 1);
  assert.equal(project.params.numberOfPreviews, 0);
  assert.equal(project.params.outputFormat, 'png');
  const sent = client.socket.sent.at(-1);
  assert.equal(sent.type, 'jobRequest');
  assert.equal(sent.data.numberOfImages, 1);
  assert.equal(sent.data.outputFormat, 'png');
  client.socket.emit('jobState', {
    type: 'jobStarted',
    jobID: project.id,
    imgID: 'mask-result-1',
    workerName: 'receipt-test-worker'
  });
  client.socket.emit('jobResult', {
    jobID: project.id,
    imgID: 'mask-result-1',
    resultUrl: 'https://cdn.example.test/mask.png',
    performedStepCount: 1,
    lastSeed: '42',
    triggeredNSFWFilter: false,
    userCanceled: false,
    sha256: 'c'.repeat(64),
    sourceImageSha256: 'a'.repeat(64),
    samPromptSha256: 'd'.repeat(64),
    maskRleSha256: 'b'.repeat(64),
    maskWidth: 1024,
    maskHeight: 576,
    samVersion: 'sam3-test'
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(project.job('mask-result-1').provenance, {
    sha256: 'c'.repeat(64),
    sourceImageSha256: 'a'.repeat(64),
    samPromptSha256: 'd'.repeat(64),
    maskRleSha256: 'b'.repeat(64),
    maskWidth: 1024,
    maskHeight: 576,
    samVersion: 'sam3-test'
  });
  project._update({ status: 'failed', error: { code: 0, message: 'test cleanup' } });

  console.log('SAM3 SDK contract checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
