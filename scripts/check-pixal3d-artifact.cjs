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

// Pixal3D multi-view: the front view is startingImage and the orbit views travel
// in fixed contextImage slots (left 1, back 2, right 3), any subset allowed. The
// single-view graph has no input for them, so it refuses them.
const MULTIVIEW_ID = 'pixal3d_multiview_int8_i23d';
const VIEW_SLOTS = { leftViewImage: 1, backViewImage: 2, rightViewImage: 3 };

function multiView(overrides = {}) {
  return params({ modelId: MULTIVIEW_ID, positivePrompt: '', ...overrides });
}

function contextFlags(request) {
  const keyFrame = request.keyFrames[0];
  return [1, 2, 3, 4].map((slot) => keyFrame[`hasContextImage${slot}`]);
}

async function checkMultiView() {
  const view = Buffer.from('view');
  const all = { leftViewImage: view, backViewImage: view, rightViewImage: view };

  const full = createJobRequestMessage(
    'pixal3d-mv-full',
    multiView({ ...all, numberOfPreviews: 4, meshTargetFaces: 200000, shapeResolution: 1536, seed: 7 }),
    MODEL_OPTIONS
  );
  assert.equal(full.keyFrames[0].modelID, MULTIVIEW_ID);
  assert.equal(full.outputFormat, 'glb', 'multi-view returns a GLB');
  assert.equal(full.previews, 0, 'multi-view never requests previews');
  assert.equal(full.keyFrames[0].hasStartingImage, true, 'front view is the starting image');
  assert.deepEqual(contextFlags(full), [true, true, true, false]);
  assert.equal(full.keyFrames[0].meshTargetFaces, 200000);
  assert.equal(full.keyFrames[0].shapeResolution, 1536);
  assert.equal('templateVariant' in full.keyFrames[0], false);

  const frontOnly = createJobRequestMessage('pixal3d-mv-front', multiView(), MODEL_OPTIONS);
  assert.deepEqual(contextFlags(frontOnly), [false, false, false, false], 'front view alone is valid');

  // Any subset keeps each view in its own slot rather than renumbering.
  for (const [viewName, slot] of Object.entries(VIEW_SLOTS)) {
    const request = createJobRequestMessage(
      `pixal3d-mv-${viewName}`,
      multiView({ [viewName]: view }),
      MODEL_OPTIONS
    );
    assert.deepEqual(
      contextFlags(request),
      [1, 2, 3, 4].map((index) => index === slot),
      `${viewName} travels in contextImage${slot}`
    );
  }
  assert.deepEqual(
    contextFlags(
      createJobRequestMessage(
        'pixal3d-mv-left-right',
        multiView({ leftViewImage: view, rightViewImage: true }),
        MODEL_OPTIONS
      )
    ),
    [true, false, true, false]
  );

  assert.throws(
    () => createJobRequestMessage('pixal3d-mv-no-front', multiView({ ...all, startingImage: undefined }), MODEL_OPTIONS),
    /Pixal3D multi-view reconstruction requires startingImage \(the front view\)/
  );
  for (const bad of [null, false, 0, '']) {
    assert.throws(
      () => createJobRequestMessage('pixal3d-mv-empty-view', multiView({ backViewImage: bad }), MODEL_OPTIONS),
      /backViewImage must be an image; leave it unset to omit that view/,
      `backViewImage ${JSON.stringify(bad)}`
    );
  }
  assert.throws(
    () => createJobRequestMessage('pixal3d-mv-context', multiView({ contextImages: [view] }), MODEL_OPTIONS),
    /pixal3d_multiview_int8_i23d takes its orbit views as leftViewImage, backViewImage and rightViewImage, not contextImages/
  );
  assert.throws(
    () =>
      createJobRequestMessage(
        'pixal3d-mv-variant',
        multiView({ templateVariant: 'i23d-birefnet' }),
        MODEL_OPTIONS
      ),
    /templateVariant is only supported by pixal3d_int8_i23d/
  );
  assert.throws(
    () => createJobRequestMessage('pixal3d-mv-texture', multiView({ textureSize: 8192 }), MODEL_OPTIONS),
    /textureSize must be an integer from 1024 to 4096/
  );

  // The single-view graph would ignore orbit views; refuse them before billing.
  for (const viewName of Object.keys(VIEW_SLOTS)) {
    assert.throws(
      () => createJobRequestMessage('pixal3d-sv-view', params({ [viewName]: view }), MODEL_OPTIONS),
      new RegExp(`pixal3d_int8_i23d reconstructs from startingImage alone and ignores ${viewName}`)
    );
    assert.throws(
      () =>
        createJobRequestMessage(
          'krea-view',
          params({ modelId: 'krea2_turbo_fp8_scaled', [viewName]: view }),
          MODEL_OPTIONS
        ),
      new RegExp(`${viewName} is only supported by pixal3d_multiview_int8_i23d`)
    );
  }
  assert.throws(
    () => createJobRequestMessage('pixal3d-sv-context', params({ contextImages: [view] }), MODEL_OPTIONS),
    /pixal3d_int8_i23d reconstructs from startingImage alone and does not support contextImages/
  );
  // Unset views are not views.
  const singleUnset = createJobRequestMessage(
    'pixal3d-sv-unset',
    params({ leftViewImage: undefined, backViewImage: undefined, rightViewImage: undefined }),
    MODEL_OPTIONS
  );
  assert.deepEqual(contextFlags(singleUnset), [false, false, false, false]);
  assert.throws(
    () => createJobRequestMessage('krea-mesh', params({ modelId: 'krea2_turbo_fp8_scaled', meshTargetFaces: 5000 }), MODEL_OPTIONS),
    /meshTargetFaces is only supported by pixal3d_int8_i23d and pixal3d_multiview_int8_i23d/
  );

  // Uploads: front through the guide-image path, each view in its own slot.
  const { client, projects } = newProjectsApi();
  const uploads = [];
  projects.uploadGuideImage = async (_projectId, file) => {
    uploads.push(['startingImage', file.toString()]);
  };
  projects.uploadContextImage = async (_projectId, index, file) => {
    uploads.push([`contextImage${index + 1}`, file.toString()]);
  };
  const project = await projects.create(
    multiView({
      startingImage: Buffer.from('front'),
      backViewImage: Buffer.from('back'),
      rightViewImage: Buffer.from('right')
    })
  );
  assert.deepEqual(
    uploads.sort(),
    [
      ['contextImage2', 'back'],
      ['contextImage3', 'right'],
      ['startingImage', 'front']
    ],
    'front, back and right upload to startingImage, contextImage2 and contextImage3'
  );
  const sent = client.socket.sent[0].data;
  assert.equal(sent.outputFormat, 'glb');
  assert.deepEqual(contextFlags(sent), [false, true, true, false]);
  project._update({ status: 'failed', error: { code: 0, message: 'test cleanup' } });

  // A refused single-view request uploads nothing.
  const refused = newProjectsApi();
  const refusedUploads = [];
  refused.projects.uploadGuideImage = async () => refusedUploads.push('startingImage');
  refused.projects.uploadContextImage = async () => refusedUploads.push('contextImage');
  await assert.rejects(
    () => refused.projects.create(params({ startingImage: Buffer.from('front'), leftViewImage: view })),
    /ignores leftViewImage/
  );
  assert.deepEqual(refusedUploads, []);
  assert.equal(refused.client.socket.sent.length, 0);
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
  await checkMultiView();

  console.log('Pixal3D SDK artifact checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
