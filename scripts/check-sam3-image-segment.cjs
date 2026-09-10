'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const createJobRequestMessage = require('../dist/Projects/createJobRequestMessage.js').default;
const ProjectsApi = require('../dist/Projects/index.js').default;

const MODEL_ID = 'sam3_image_segment_bf16';
// Mirrors MAX_SAM3_INSTANCES in src/Projects/createJobRequestMessage.ts.
const MAX_INSTANCES = 16;
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
    multimask: true,
    // Omitting applyMask must serialize as an explicit false, not as absence.
    applyMask: false
  });
  // An omitted cap stays off the wire entirely rather than being sent as a default.
  assert.equal('maxInstances' in request.keyFrames[0].sam3Prompt, false);

  // Declining multimask on the text path is not a mistake. It only chooses among
  // SAM's whole/part/subpart candidates for one ambiguous click, so `false` says
  // exactly what the text path already does, and rejecting it refused a valid
  // request. Worse, the throw reached callers as the generic "a worker couldn't
  // complete this generation", which reads as missing capacity rather than a
  // rejected field, so it went undiagnosed and cost a whole selection.
  const declined = createJobRequestMessage(
    'sam3-multimask-false',
    params({ sam3Prompt: { text: 'the picnic basket', multimask: false } }),
    MODEL_OPTIONS
  );
  // Accepted, and then left off the wire entirely, which is what a no-op should
  // look like: the caller's intent is honoured without inventing a field.
  assert.deepEqual(declined.keyFrames[0].sam3Prompt, {
    points: [],
    boxes: [],
    text: 'the picnic basket',
    threshold: 0.5,
    applyMask: false
  });

  // Asking FOR multimask without points is still a real mistake and still named.
  assert.throws(
    () => createJobRequestMessage(
      'sam3-multimask-true-no-points',
      params({ sam3Prompt: { text: 'the picnic basket', multimask: true } }),
      MODEL_OPTIONS
    ),
    /multimask requires point prompts/,
    'multimask: true without points must still be rejected'
  );

  // applyMask and maxInstances shipped in the request contract and in this
  // function's own validation, but the root-level unknown-key gate above it was
  // never taught either name, so both were rejected before they could be
  // validated. That made the whole feature unreachable in 5.32.0 and 5.33.0.
  const cutout = createJobRequestMessage(
    'sam3-apply-mask',
    params({ sam3Prompt: { text: 'the teapot', applyMask: true } }),
    MODEL_OPTIONS
  );
  assert.deepEqual(cutout.keyFrames[0].sam3Prompt, {
    points: [],
    boxes: [],
    text: 'the teapot',
    threshold: 0.5,
    applyMask: true
  });

  const capped = createJobRequestMessage(
    'sam3-max-instances',
    params({ sam3Prompt: { text: 'the teapots', maxInstances: 4 } }),
    MODEL_OPTIONS
  );
  assert.equal(capped.keyFrames[0].sam3Prompt.maxInstances, 4);
  assert.equal(capped.keyFrames[0].sam3Prompt.applyMask, false);

  for (const maxInstances of [0, MAX_INSTANCES + 1]) {
    assert.throws(
      () =>
        createJobRequestMessage(
          'sam3-max-instances-range',
          params({ sam3Prompt: { text: 'the teapots', maxInstances } }),
          MODEL_OPTIONS
        ),
      new RegExp(`sam3Prompt.maxInstances must be an integer from 1 to ${MAX_INSTANCES}`)
    );
  }

  // The gate still has to reject a name the request contract has no field for,
  // which is the only reason it exists.
  assert.throws(
    () =>
      createJobRequestMessage(
        'sam3-unknown-root-key',
        params({ sam3Prompt: { text: 'the teapot', bogus: 1 } }),
        MODEL_OPTIONS
      ),
    /sam3Prompt contains unsupported fields: bogus/
  );

  // A negative box excludes one instance of a text-prompted concept. Its own
  // box-level key check already allows 'label'; pin the round trip so it does
  // not regress the way the root-level gate did.
  const excluded = createJobRequestMessage(
    'sam3-negative-box',
    params({
      sam3Prompt: {
        text: 'the teapots',
        boxes: [{ x0: 0.1, y0: 0.2, x1: 0.3, y1: 0.4, label: 'negative' }]
      }
    }),
    MODEL_OPTIONS
  );
  assert.deepEqual(excluded.keyFrames[0].sam3Prompt.boxes, [
    { x0: 0.1, y0: 0.2, x1: 0.3, y1: 0.4, label: 'negative' }
  ]);

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
  // A segmentation job reports type 'image' on an image project, so the media
  // guard alone lets it through: enhance() would download the mask PNG and
  // submit it as the starting image of a paid Flux render. Nothing about the
  // request may reach the socket.
  const requestsBefore = client.socket.sent.length;
  await assert.rejects(
    () => project.job('mask-result-1').enhance('medium'),
    /Enhancement is not available for segmentation masks/,
    'a SAM 3 mask must not be enhanceable'
  );
  assert.equal(
    client.socket.sent.length,
    requestsBefore,
    'a rejected enhancement must not send a job request'
  );

  project._update({ status: 'failed', error: { code: 0, message: 'test cleanup' } });

  console.log('SAM3 SDK contract checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
