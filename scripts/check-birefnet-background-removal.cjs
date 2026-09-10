'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const createJobRequestMessage = require('../dist/Projects/createJobRequestMessage.js').default;
const ProjectsApi = require('../dist/Projects/index.js').default;

const MODEL_ID = 'birefnet_image_background_removal_fp16';
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
    // BiRefNet takes no prompt: it finds the salient foreground on its own.
    positivePrompt: '',
    numberOfMedia: 4,
    numberOfPreviews: 5,
    outputFormat: 'jpg',
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
  // The whole request contract, on the wire. applyMask is what the socket
  // forwards into clientParams for this workflow id, so if it is missing here
  // the cutout branch of the graph is unreachable from this SDK.
  const mask = createJobRequestMessage('birefnet-wire-test', params(), MODEL_OPTIONS);
  assert.equal(mask.keyFrames[0].hasStartingImage, true);
  // Omitting it serializes as an explicit false, not as absence: which artifact
  // the job returns is decided by the request, not by the worker's default.
  assert.equal(mask.keyFrames[0].applyMask, false);
  // Deterministic, so four copies of one source are four identical masks.
  assert.equal(mask.numberOfImages, 1);
  // Nothing to preview: there is no diffusion, only one matte.
  assert.equal(mask.previews, 0);
  // A soft matte, and a cutout whose alpha IS that matte. jpg would quantize
  // the first and flatten the second away, so the request is not the caller's
  // to lose here.
  assert.equal(mask.outputFormat, 'png');

  const cutout = createJobRequestMessage(
    'birefnet-apply-mask',
    params({ applyMask: true }),
    MODEL_OPTIONS
  );
  assert.equal(cutout.keyFrames[0].applyMask, true);

  const explicitMask = createJobRequestMessage(
    'birefnet-explicit-false',
    params({ applyMask: false }),
    MODEL_OPTIONS
  );
  assert.equal(explicitMask.keyFrames[0].applyMask, false);

  assert.throws(
    () => createJobRequestMessage('birefnet-non-boolean', params({ applyMask: 'yes' }), MODEL_OPTIONS),
    /applyMask must be a boolean/
  );
  assert.throws(
    () => createJobRequestMessage('missing-source', params({ startingImage: undefined }), MODEL_OPTIONS),
    /BiRefNet background removal requires startingImage/
  );

  // SAM 3 has its own applyMask, nested inside sam3Prompt. The top-level field
  // belongs to exactly one model and must not silently do nothing anywhere
  // else. Each case is otherwise a valid request for that model, so the
  // rejection is the applyMask gate and not some earlier requirement.
  const wrongModelCases = [
    { modelId: 'krea2_turbo_fp8_scaled', positivePrompt: 'a teapot' },
    {
      modelId: 'sam3_image_segment_bf16',
      sam3Prompt: { text: 'the teapot' }
    },
    { modelId: 'pixal3d_int8_i23d', positivePrompt: 'the red ceramic teapot' }
  ];
  for (const overrides of wrongModelCases) {
    assert.throws(
      () =>
        createJobRequestMessage(
          'birefnet-wrong-model',
          params({ ...overrides, applyMask: true }),
          MODEL_OPTIONS
        ),
      /applyMask is only supported by birefnet_image_background_removal_fp16/,
      `applyMask must be rejected for ${overrides.modelId}`
    );
  }

  // A SAM 3 request still carries its own nested applyMask untouched.
  const sam3 = createJobRequestMessage(
    'sam3-nested-apply-mask',
    {
      type: 'image',
      modelId: 'sam3_image_segment_bf16',
      positivePrompt: '',
      numberOfMedia: 1,
      startingImage: true,
      sam3Prompt: { text: 'the teapot', applyMask: true }
    },
    MODEL_OPTIONS
  );
  assert.equal(sam3.keyFrames[0].sam3Prompt.applyMask, true);
  assert.equal('applyMask' in sam3.keyFrames[0], false);

  const client = new ClientStub();
  const projects = new ProjectsApi({ client, eip712: {} });
  projects.getModelOptions = async () => MODEL_OPTIONS;
  const project = await projects.create(params({ applyMask: true }));
  // The Project's own params must agree with the request that was sent.
  assert.equal(project.params.numberOfMedia, 1);
  assert.equal(project.params.numberOfPreviews, 0);
  assert.equal(project.params.outputFormat, 'png');
  const sent = client.socket.sent.at(-1);
  assert.equal(sent.type, 'jobRequest');
  assert.equal(sent.data.numberOfImages, 1);
  assert.equal(sent.data.previews, 0);
  assert.equal(sent.data.outputFormat, 'png');
  assert.equal(sent.data.keyFrames[0].applyMask, true);

  client.socket.emit('jobState', {
    type: 'jobStarted',
    jobID: project.id,
    imgID: 'birefnet-result-1',
    workerName: 'birefnet-test-worker'
  });
  client.socket.emit('jobResult', {
    jobID: project.id,
    imgID: 'birefnet-result-1',
    resultUrl: 'https://cdn.example.test/cutout.png',
    performedStepCount: 1,
    lastSeed: '0',
    triggeredNSFWFilter: false,
    userCanceled: false
  });
  await new Promise((resolve) => setImmediate(resolve));

  // A matte reports type 'image' on an image project, so the media guard alone
  // lets it through: enhance() would download it and submit it as the starting
  // image of a paid render. It has no prompt-to-pixels relationship to enhance.
  const requestsBefore = client.socket.sent.length;
  await assert.rejects(
    () => project.job('birefnet-result-1').enhance('medium'),
    /Enhancement is not available for segmentation masks/,
    'a BiRefNet matte must not be enhanceable'
  );
  assert.equal(
    client.socket.sent.length,
    requestsBefore,
    'a rejected enhancement must not send a job request'
  );

  project._update({ status: 'failed', error: { code: 0, message: 'test cleanup' } });

  console.log('BiRefNet SDK contract checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
