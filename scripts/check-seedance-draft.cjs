/**
 * Seedance 2.5 draft mode: `seedanceDraft` creates a 480p draft and
 * `seedanceDraftJobId` finalizes it at 1080p. Checks the keyFrame wire fields,
 * the client-side model and exclusivity checks, the estimate query, and the
 * draft result fields on jobs and completion events.
 *
 * Runs against compiled `dist/` output, like the sibling check-* scripts.
 * Run: npm run test:seedance-draft
 */

'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const createJobRequestMessage = require('../dist/Projects/createJobRequestMessage.js').default;
const ProjectsApi = require('../dist/Projects/index.js').default;
const Project = require('../dist/Projects/Project.js').default;
const Job = require('../dist/Projects/Job.js').default;

const SILENT_LOGGER = { info() {}, warn() {}, error() {}, debug() {} };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const DRAFT_JOB_ID = 'd7c0a4f2-5b1e-4c8a-9f3d-2e6b7a1c9d40';
const EXPIRES_AT = '2026-11-17T20:00:00.000Z';
const SEEDANCE_25_MODELS = ['seedance-2-5', 'seedance-2-5-uncensored'];

const VIDEO_OPTIONS = {
  type: 'video',
  width: { min: 480, max: 1470, step: 8, default: 1280 },
  height: { min: 432, max: 1280, step: 8, default: 720 },
  sampler: { allowed: [], default: null },
  scheduler: { allowed: [], default: null }
};

function draftRequest(overrides = {}) {
  return createJobRequestMessage(
    '00000000-0000-4000-8000-000000000001',
    {
      type: 'video',
      modelId: 'seedance-2-5',
      positivePrompt: 'A lighthouse keeper climbs a spiral stair as a storm rolls in',
      numberOfMedia: 1,
      duration: 8,
      width: 864,
      height: 496,
      seedanceDraft: true,
      ...overrides
    },
    VIDEO_OPTIONS
  );
}

function finalizeRequest(overrides = {}) {
  return createJobRequestMessage(
    '00000000-0000-4000-8000-000000000002',
    {
      type: 'video',
      modelId: 'seedance-2-5',
      positivePrompt: '',
      numberOfMedia: 1,
      seedanceDraftJobId: DRAFT_JOB_ID,
      ...overrides
    },
    VIDEO_OPTIONS
  );
}

// --- 1. Draft requests carry seedanceDraft, with every normal 2.5 input ----------------------
for (const modelId of SEEDANCE_25_MODELS) {
  const frame = draftRequest({ modelId }).keyFrames[0];
  assert.equal(frame.seedanceDraft, true);
  assert.equal(frame.modelID, modelId);
  assert.equal(frame.frames, 8 * 24 + 1, 'a draft keeps its own duration');
  assert.equal(frame.width, 864);
  assert.equal(frame.height, 496);
  assert.equal(frame.seedanceDraftJobId, undefined);

  const withReferences = draftRequest({
    modelId,
    seed: 1234,
    generateAudio: false,
    referenceImageUrls: ['https://cdn.example.com/keeper.jpg'],
    referenceVideoUrls: ['https://cdn.example.com/storm.mp4'],
    referenceAudioUrls: ['https://cdn.example.com/wind.mp3'],
    seedanceTaskType: 'reference'
  }).keyFrames[0];
  assert.equal(withReferences.seedanceDraft, true);
  assert.equal(withReferences.seed, 1234);
  assert.equal(withReferences.generateAudio, false);
  assert.equal(withReferences.seedanceTaskType, 'reference');
  assert.equal(withReferences.referenceVideoURLs.length, 1);

  const fromFrames = draftRequest({
    modelId,
    referenceImage: new Blob(['first'], { type: 'image/png' }),
    referenceImageEnd: new Blob(['last'], { type: 'image/png' })
  }).keyFrames[0];
  assert.equal(fromFrames.seedanceDraft, true);
  assert.equal(fromFrames.hasReferenceImage, true);
  assert.equal(fromFrames.hasReferenceImageEnd, true);
}

// seedanceDraft: false and an absent field leave today's request unchanged.
{
  const plain = draftRequest({ seedanceDraft: undefined });
  const explicitFalse = draftRequest({ seedanceDraft: false });
  for (const request of [plain, explicitFalse]) {
    assert.equal('seedanceDraft' in request.keyFrames[0], false);
    assert.equal('seedanceDraftJobId' in request.keyFrames[0], false);
  }
  assert.deepEqual(explicitFalse, plain);
}
console.log('Seedance 2.5 draft request checks passed');

// --- 2. Finalize requests carry only the draft's job id ------------------------------------
for (const modelId of SEEDANCE_25_MODELS) {
  const request = finalizeRequest({ modelId, outputFormat: 'mov', returnLastFrame: true });
  const frame = request.keyFrames[0];
  assert.equal(frame.seedanceDraftJobId, DRAFT_JOB_ID);
  assert.equal(frame.modelID, modelId);
  assert.equal(frame.seedanceDraft, undefined);
  assert.ok(frame.positivePrompt.trim(), 'a finalize sends a non-empty placeholder prompt');
  for (const inherited of [
    'frames',
    'seed',
    'ratio',
    'generateAudio',
    'seedanceTaskType',
    'referenceImageURLs',
    'referenceVideoURLs',
    'referenceAudioURLs',
    'hasReferenceImage',
    'hasReferenceImageEnd',
    'hasReferenceVideo',
    'hasReferenceAudio',
    'hasReferenceAudioIdentity'
  ]) {
    assert.equal(frame[inherited], undefined, `a finalize must not send ${inherited}`);
  }
  // The re-settable delivery options still travel.
  assert.equal(request.outputFormat, 'mov');
  assert.equal(frame.returnLastFrame, true);
  assert.equal(request.numberOfImages, 1);
}

// The caller's prompt never travels: the final uses the draft's.
assert.equal(
  finalizeRequest({ positivePrompt: 'a different idea' }).keyFrames[0].positivePrompt,
  finalizeRequest().keyFrames[0].positivePrompt
);

// Everything the vendor inherits from the draft is refused, one field at a time.
const INHERITED_INPUTS = {
  referenceImage: new Blob(['first'], { type: 'image/png' }),
  referenceImageEnd: new Blob(['last'], { type: 'image/png' }),
  referenceImageUrls: ['https://cdn.example.com/keeper.jpg'],
  referenceVideo: new Blob(['video'], { type: 'video/mp4' }),
  referenceVideoUrls: ['https://cdn.example.com/storm.mp4'],
  referenceAudio: new Blob(['audio'], { type: 'audio/mpeg' }),
  referenceAudioUrls: ['https://cdn.example.com/wind.mp3'],
  referenceAudioIdentity: new Blob(['voice'], { type: 'audio/mpeg' }),
  duration: 8,
  frames: 193,
  ratio: '16:9',
  seed: 1234,
  generateAudio: true,
  seedanceTaskType: 'reference'
};
for (const [field, value] of Object.entries(INHERITED_INPUTS)) {
  assert.throws(
    () => finalizeRequest({ [field]: value }),
    new RegExp(`finalize reuses its draft's inputs and settings; remove ${field}\\.`),
    `finalize must refuse ${field}`
  );
}
assert.throws(
  () => finalizeRequest({ duration: 8, seed: 7, generateAudio: false }),
  /remove duration, seed, generateAudio\./
);
// An empty reference list is the same as none.
assert.equal(
  finalizeRequest({ referenceImageUrls: [] }).keyFrames[0].seedanceDraftJobId,
  DRAFT_JOB_ID
);
assert.throws(() => finalizeRequest({ numberOfMedia: 2 }), /numberOfMedia must be 1/);
console.log('Seedance 2.5 finalize request checks passed');

// --- 3. Mutually exclusive, well-formed, Seedance 2.5 only ---------------------------------
assert.throws(
  () => finalizeRequest({ seedanceDraft: true }),
  /seedanceDraft and seedanceDraftJobId are mutually exclusive/
);
// A finalize may say plainly that it is not itself a draft.
assert.equal(
  finalizeRequest({ seedanceDraft: false }).keyFrames[0].seedanceDraftJobId,
  DRAFT_JOB_ID
);
assert.throws(() => draftRequest({ seedanceDraft: 'true' }), /seedanceDraft must be a boolean/);
for (const badId of ['', '   ', 42, null]) {
  assert.throws(
    () => finalizeRequest({ seedanceDraftJobId: badId }),
    /seedanceDraftJobId must be the Sogni job id of a Seedance 2.5 draft/,
    `seedanceDraftJobId ${JSON.stringify(badId)}`
  );
}
for (const modelId of [
  'seedance-2-0',
  'seedance-2-0-mini',
  'seedance-2-0-mini-uncensored',
  'happyhorse-1.1-t2v',
  'wan3.0-video',
  'ltx23-22b-fp8_t2v_distilled'
]) {
  assert.throws(
    () => draftRequest({ modelId, width: 1280, height: 720, duration: 5 }),
    /Seedance draft mode is supported only by Seedance 2.5/,
    `${modelId} must refuse seedanceDraft`
  );
  assert.throws(
    () => finalizeRequest({ modelId }),
    /Seedance draft mode is supported only by Seedance 2.5/,
    `${modelId} must refuse seedanceDraftJobId`
  );
}
// Off is off on every model: seedanceDraft: false changes nothing anywhere.
assert.equal(
  draftRequest({ modelId: 'seedance-2-0', seedanceDraft: false, width: 1280, height: 720 })
    .keyFrames[0].seedanceDraft,
  undefined
);
console.log('Seedance draft model and exclusivity checks passed');

// --- 4. The video estimate quotes drafts and finalizes ------------------------------------
class EstimateSocket extends EventEmitter {
  constructor() {
    super();
    this.paths = [];
  }
  async get(path) {
    this.paths.push(path);
    const cost = {
      costInToken: '1',
      costInUSD: '0.01',
      costInSpark: '2',
      costInSogni: '3',
      costInRenderSec: '8'
    };
    return { quote: { job: cost, project: cost } };
  }
}

async function checkEstimates() {
  const client = new EventEmitter();
  client.socket = new EstimateSocket();
  client.logger = SILENT_LOGGER;
  const projects = new ProjectsApi({ client, eip712: {} });
  const base = {
    tokenType: 'spark',
    model: 'seedance-2-5',
    width: 864,
    height: 496,
    duration: 8,
    fps: 24,
    numberOfMedia: 1
  };
  const lastQuery = () =>
    new URL(`https://socket.test${client.socket.paths.at(-1)}`).searchParams;

  await projects.estimateVideoCost(base);
  const legacyPath = client.socket.paths.at(-1);
  assert.equal(legacyPath, '/api/v1/job-video/estimate/spark/seedance-2-5/864/496/193/24');

  await projects.estimateVideoCost({ ...base, seedanceDraft: false });
  assert.equal(client.socket.paths.at(-1), legacyPath, 'seedanceDraft: false sends nothing new');

  await projects.estimateVideoCost({ ...base, seedanceDraft: true });
  assert.equal(lastQuery().get('seedanceDraft'), '1');
  assert.equal(lastQuery().has('seedanceDraftJobId'), false);
  assert.ok(client.socket.paths.at(-1).startsWith(`${legacyPath}?`), 'the path is unchanged');

  const quote = await projects.estimateVideoCost({
    ...base,
    model: 'seedance-2-5-uncensored',
    seedanceDraftJobId: DRAFT_JOB_ID
  });
  assert.equal(lastQuery().get('seedanceDraftJobId'), DRAFT_JOB_ID);
  assert.equal(lastQuery().has('seedanceDraft'), false);
  assert.equal(quote.spark, '2');

  const before = client.socket.paths.length;
  await assert.rejects(
    projects.estimateVideoCost({ ...base, seedanceDraft: true, seedanceDraftJobId: DRAFT_JOB_ID }),
    /mutually exclusive/
  );
  await assert.rejects(
    projects.estimateVideoCost({
      ...base,
      model: 'seedance-2-0',
      width: 1280,
      height: 720,
      seedanceDraft: true
    }),
    /supported only by Seedance 2.5/
  );
  await assert.rejects(
    projects.estimateVideoCost({ ...base, model: 'seedance-2-0-mini', seedanceDraftJobId: DRAFT_JOB_ID }),
    /supported only by Seedance 2.5/
  );
  await assert.rejects(
    projects.estimateVideoCost({ ...base, seedanceDraftJobId: '' }),
    /must be the Sogni job id/
  );
  assert.equal(client.socket.paths.length, before, 'refused estimates send no request');
  console.log('Seedance draft estimate checks passed');
}

// --- 5. Result fields reach the job and the completion event ------------------------------
function makeResultHarness() {
  const socket = new EventEmitter();
  socket.send = async () => {};
  socket.get = async () => {
    throw Object.assign(new Error('Not Found'), { status: 404 });
  };
  const client = new EventEmitter();
  client.socket = socket;
  client.appId = 'app-under-test';
  client.logger = SILENT_LOGGER;
  client.rest = {
    async get(path, query) {
      return {
        status: 'success',
        data: { downloadUrl: `https://cdn.test${path}/${query.jobId}/${query.id}` }
      };
    }
  };
  const api = new ProjectsApi({ client, eip712: {} });
  api._listActiveProjectIds = async () => null;
  const completed = [];
  api.on('job', (event) => {
    if (event.type === 'completed') completed.push(event);
  });
  return { api, socket, completed };
}

function trackVideo(api, params) {
  const project = new Project(
    {
      type: 'video',
      modelId: 'seedance-2-5',
      numberOfMedia: 1,
      positivePrompt: 'A lighthouse keeper climbs a spiral stair',
      ...params
    },
    { api, logger: SILENT_LOGGER }
  );
  api.projects.push(project);
  project.data.startedAt = new Date(Date.now() - 60_000);
  return project;
}

function stopTimers(api) {
  for (const project of api.projects) {
    if (project._timeout) clearInterval(project._timeout);
    for (const job of project.jobs) job._stopRuntimeTimeout?.();
  }
}

function resultFrame(jobID, imgID, extra = {}) {
  return {
    jobID,
    imgID,
    performedStepCount: 1,
    triggeredNSFWFilter: false,
    userCanceled: false,
    resultUrl: `https://cdn.example.com/${imgID}.mp4`,
    ...extra
  };
}

async function checkResultFields() {
  // A draft whose job the client already tracks: the fields are set by the time
  // the job's own `completed` event fires.
  {
    const { api, socket, completed } = makeResultHarness();
    const project = trackVideo(api, { seedanceDraft: true });
    const job = project._addJob({
      id: DRAFT_JOB_ID,
      projectId: project.id,
      status: 'processing',
      step: 0,
      stepCount: 1
    });
    let seenAtCompletion;
    job.on('completed', () => {
      seenAtCompletion = { draft: job.seedanceDraft, expiresAt: job.seedanceDraftExpiresAt };
    });
    socket.emit(
      'jobResult',
      resultFrame(project.id, DRAFT_JOB_ID, {
        seedanceDraft: true,
        seedanceDraftExpiresAt: EXPIRES_AT
      })
    );
    await sleep(10);
    assert.deepEqual(seenAtCompletion, { draft: true, expiresAt: EXPIRES_AT });
    assert.equal(job.seedanceDraftJobId, undefined);
    assert.equal(completed.length, 1);
    assert.equal(completed[0].seedanceDraft, true);
    assert.equal(completed[0].seedanceDraftExpiresAt, EXPIRES_AT);
    assert.equal('seedanceDraftJobId' in completed[0], false);
    stopTimers(api);
  }

  // A final whose job is first seen in its completion still carries its draft id.
  {
    const { api, socket, completed } = makeResultHarness();
    const project = trackVideo(api, { positivePrompt: '', seedanceDraftJobId: DRAFT_JOB_ID });
    socket.emit('jobResult', resultFrame(project.id, 'FINAL-1', { seedanceDraftJobId: DRAFT_JOB_ID }));
    await sleep(10);
    const job = project.job('FINAL-1');
    assert.ok(job, 'the completion adds the job');
    assert.equal(job.status, 'completed');
    assert.equal(job.seedanceDraftJobId, DRAFT_JOB_ID);
    assert.equal(job.seedanceDraft, undefined);
    assert.equal(completed[0].seedanceDraftJobId, DRAFT_JOB_ID);
    stopTimers(api);
  }

  // Ordinary results gain no keys, and malformed values are dropped.
  {
    const { api, socket, completed } = makeResultHarness();
    const project = trackVideo(api, {});
    socket.emit('jobResult', resultFrame(project.id, 'PLAIN-1'));
    socket.emit(
      'jobResult',
      resultFrame(project.id, 'ODD-1', {
        seedanceDraft: 'yes',
        seedanceDraftExpiresAt: 1763409600000,
        seedanceDraftJobId: ''
      })
    );
    await sleep(10);
    for (const event of completed) {
      for (const key of ['seedanceDraft', 'seedanceDraftExpiresAt', 'seedanceDraftJobId']) {
        assert.equal(key in event, false, `${event.jobId} must not report ${key}`);
        assert.equal(project.job(event.jobId)[key], undefined);
      }
    }
    stopTimers(api);
  }

  // Recovered and REST job records: top-level fields, or the allowlisted
  // `result` receipt, and a later record without them clears nothing.
  {
    const { api } = makeResultHarness();
    const project = trackVideo(api, { seedanceDraft: true });
    const options = { api, logger: SILENT_LOGGER, project };
    const raw = {
      id: project.id,
      SID: '1',
      imgID: DRAFT_JOB_ID,
      worker: { name: 'vendor' },
      status: 'jobCompleted',
      reason: 'jobCompleted',
      performedSteps: 1,
      triggeredNSFWFilter: false,
      seedUsed: 1,
      resultUrl: 'https://cdn.example.com/draft.mp4'
    };
    const top = Job.fromRaw(
      { id: project.id, stepCount: 1 },
      { ...raw, seedanceDraft: true, seedanceDraftExpiresAt: EXPIRES_AT },
      options
    );
    assert.equal(top.seedanceDraft, true);
    assert.equal(top.seedanceDraftExpiresAt, EXPIRES_AT);
    const nested = Job.fromRaw(
      { id: project.id, stepCount: 1 },
      { ...raw, result: { seedanceDraftJobId: DRAFT_JOB_ID } },
      options
    );
    assert.equal(nested.seedanceDraftJobId, DRAFT_JOB_ID);
    await top._syncWithRestData(raw);
    assert.equal(top.seedanceDraft, true, 'a record without the fields keeps them');
    assert.equal(top.seedanceDraftExpiresAt, EXPIRES_AT);
    top._stopRuntimeTimeout?.();
    nested._stopRuntimeTimeout?.();
    stopTimers(api);
  }
  console.log('Seedance draft result field checks passed');
}

(async () => {
  await checkEstimates();
  await checkResultFields();
  console.log('Seedance 2.5 draft checks passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
