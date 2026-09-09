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

function newProjectsApi() {
  const client = new ClientStub();
  const projects = new ProjectsApi({ client, eip712: {} });
  projects.getModelOptions = async () => MODEL_OPTIONS;
  return { client, projects };
}

// A model-artifact model must resolve as one even when the served catalog says
// otherwise. The live /models/list route regressed to `media: 'image'` for
// Pixal3D, which routed every GLB to the image download endpoint.
function checkCatalogCannotDowngradeArtifactModel() {
  const { projects } = newProjectsApi();
  projects._supportedModels = {
    data: [{ id: MODEL_ID, media: 'image' }],
    updatedAt: new Date()
  };
  assert.equal(
    projects.isModelArtifactModelId(MODEL_ID),
    true,
    'a pixal3d_ id must stay a model artifact even when the catalog says image'
  );

  // The catalog stays authoritative for ids the SDK has no prefix knowledge of.
  projects._supportedModels = {
    data: [{ id: 'future_recon_v1', media: 'model' }],
    updatedAt: new Date()
  };
  assert.equal(
    projects.isModelArtifactModelId('future_recon_v1'),
    true,
    'an unknown id must still follow the catalog media field'
  );
  assert.equal(projects.isModelArtifactModelId('flux1-schnell-fp8'), false);
}

// Pixal3D reconstructs a 3D artifact, so there are no intermediate images to
// preview. Both the wire request and the Project's own params must say 0.
async function checkPreviewsPinnedToZero() {
  const request = createJobRequestMessage(
    'pixal3d-previews',
    params({ numberOfPreviews: 6 }),
    MODEL_OPTIONS
  );
  assert.equal(request.previews, 0, 'Pixal3D must never request image previews');

  const { client, projects } = newProjectsApi();
  const project = await projects.create(params({ numberOfPreviews: 6 }));
  assert.equal(project.params.numberOfPreviews, 0, 'Pixal3D project params must pin previews to 0');
  assert.equal(client.socket.sent[0].data.previews, 0);
  project._update({ status: 'failed', error: { code: 0, message: 'test cleanup' } });
}

// Regression: a job learned about for the first time through the REST snapshot
// (a reconnect, or an explicit sync while the project runs) used to be added
// with resultUrl: null and never minted one, because Job.fromRaw only copies
// the legacy *Url fields and a GLB carries none of them.
async function checkRestDiscoveredJobGetsResultUrl() {
  const { projects } = newProjectsApi();
  const mediaCalls = [];
  projects.mediaDownloadUrl = async (input) => {
    mediaCalls.push(input);
    return 'https://cdn.example.test/rest-synced.glb';
  };
  projects.downloadUrl = async () => {
    throw new Error('Pixal3D must not use the image endpoint');
  };

  const project = await projects.create(params());
  // No jobState/jobResult socket event ever arrives for this job.
  projects.get = async () => ({
    id: project.id,
    imageCount: 1,
    stepCount: 56,
    previewCount: 0,
    status: 'completed',
    reason: null,
    completedWorkerJobs: [
      {
        id: project.id,
        imgID: 'rest-only-1',
        worker: { name: 'pixal3d-test-worker' },
        status: 'jobCompleted',
        reason: 'jobCompleted',
        performedSteps: 56,
        triggeredNSFWFilter: false,
        seedUsed: 42
      }
    ]
  });
  await project._syncToServer();

  const job = project.job('rest-only-1');
  assert.ok(job, 'REST sync must add a job it has not seen before');
  assert.equal(job.status, 'completed');
  assert.equal(job.type, 'model');
  assert.equal(
    job.resultUrl,
    'https://cdn.example.test/rest-synced.glb',
    'a REST-discovered completed job must have its result URL minted'
  );
  assert.deepEqual(mediaCalls, [
    {
      jobId: project.id,
      id: 'rest-only-1',
      type: 'complete',
      contentType: 'model/gltf-binary'
    }
  ]);
  assert.deepEqual(
    await project.waitForCompletion(),
    ['https://cdn.example.test/rest-synced.glb'],
    'waitForCompletion must not resolve with a missing URL'
  );
}

// ComfyUI registers one prompt-free BiRefNet graph under this workflow id.
// Naming anything else must fail locally rather than reaching template lookup.
function checkTemplateVariantSelection() {
  const unnamed = createJobRequestMessage('pixal3d-default-variant', params(), MODEL_OPTIONS);
  assert.equal(
    'templateVariant' in unnamed.keyFrames[0],
    false,
    'an unnamed request must let each worker run its own default graph'
  );

  const named = createJobRequestMessage(
    'pixal3d-variant-i23d-birefnet',
    params({ templateVariant: 'i23d-birefnet' }),
    MODEL_OPTIONS
  );
  assert.equal(named.keyFrames[0].templateVariant, 'i23d-birefnet');

  // The prompt-free graph does not need one.
  const birefnet = createJobRequestMessage(
    'pixal3d-birefnet-no-prompt',
    params({ templateVariant: 'i23d-birefnet', positivePrompt: '' }),
    MODEL_OPTIONS
  );
  assert.equal(birefnet.keyFrames[0].templateVariant, 'i23d-birefnet');

  // The retired prompted graph is no longer a valid option.
  assert.throws(
    () =>
      createJobRequestMessage(
        'pixal3d-retired-variant',
        params({ templateVariant: 'i23d', positivePrompt: 'the subject' }),
        MODEL_OPTIONS
      ),
    /templateVariant must be one of: i23d-birefnet/
  );

  // A closed list, not a passthrough.
  assert.throws(
    () =>
      createJobRequestMessage(
        'pixal3d-unknown-variant',
        params({ templateVariant: 'i23d-experimental' }),
        MODEL_OPTIONS
      ),
    /templateVariant must be one of: i23d-birefnet/
  );
  assert.throws(
    () =>
      createJobRequestMessage(
        'pixal3d-variant-wrong-model',
        params({ modelId: 'krea2_turbo_fp8_scaled', templateVariant: 'i23d-birefnet' }),
        MODEL_OPTIONS
      ),
    /templateVariant is only supported by pixal3d_int8_i23d/
  );
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
  checkTemplateVariantSelection();

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

  checkCatalogCannotDowngradeArtifactModel();
  await checkPreviewsPinnedToZero();
  await checkRestDiscoveredJobGetsResultUrl();

  console.log('Pixal3D SDK artifact checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
