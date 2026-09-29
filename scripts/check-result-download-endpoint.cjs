/**
 * Regression tests for choosing the download endpoint of a finished job.
 *
 * Images come from `/v1/image/downloadUrl`; video, audio and 3D artifacts from
 * `/v1/media/downloadUrl`. The SDK used to read "no evidence" as "image": a
 * result for a project it did not track (another tab's, with `multiInstance`)
 * and a model whose catalog entry had no media kind both went to the image
 * endpoint, which answers a provable video or audio result with 404 "This
 * result is media, not an image; request it from /v1/media/downloadUrl".
 *
 * Runs against compiled `dist/` output, like the sibling check-* scripts.
 */

'use strict';

const assert = require('node:assert/strict');

const ProjectsApi = require('../dist/Projects/index.js').default;
const Project = require('../dist/Projects/Project.js').default;
const { ApiError } = require('../dist/ApiClient/index.js');
const {
  resultMediaEvidence,
  isVideoModel,
  isAudioModel
} = require('../dist/Projects/utils/index.js');

const SILENT_LOGGER = { info() {}, warn() {}, error() {}, debug() {} };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const IMAGE_PATH = '/v1/image/downloadUrl';
const MEDIA_PATH = '/v1/media/downloadUrl';
const MEDIA_REFUSAL = new ApiError(404, {
  status: 'error',
  errorCode: 122,
  message: 'This result is media, not an image; request it from /v1/media/downloadUrl'
});

class Emitter {
  constructor() {
    this.listeners = new Map();
  }
  on(event, listener) {
    const listeners = this.listeners.get(event) ?? [];
    listeners.push(listener);
    this.listeners.set(event, listeners);
    return () => this.off(event, listener);
  }
  off(event, listener) {
    this.listeners.set(
      event,
      (this.listeners.get(event) ?? []).filter((candidate) => candidate !== listener)
    );
  }
  emit(event, data) {
    for (const listener of this.listeners.get(event) ?? []) listener(data);
  }
}

/**
 * A ProjectsApi on a stub client. `respond(path, query)` may return a URL or
 * throw; by default both download endpoints answer with a URL naming the path.
 */
function makeHarness({ respond, catalog = null } = {}) {
  const socket = new Emitter();
  socket.send = async () => {};
  socket.get = async () => {
    throw Object.assign(new Error('Not Found'), { status: 404 });
  };
  const client = new Emitter();
  client.socket = socket;
  client.appId = 'app-under-test';
  client.logger = SILENT_LOGGER;
  const calls = [];
  client.rest = {
    async get(path, query) {
      if (path !== IMAGE_PATH && path !== MEDIA_PATH) {
        throw Object.assign(new Error('Not Found'), { status: 404 });
      }
      calls.push({ path, query: { ...query } });
      const url = respond
        ? await respond(path, query)
        : `https://cdn.test${path}/${query.jobId}/${query.imageId || query.id}`;
      return { status: 'success', data: { downloadUrl: url } };
    }
  };
  const api = new ProjectsApi({ client, eip712: {} });
  api._listActiveProjectIds = async () => null;
  if (catalog) api._supportedModels = { data: catalog, updatedAt: new Date() };
  const completed = [];
  api.on('job', (event) => {
    if (event.type === 'completed') completed.push(event);
  });
  return { api, socket, calls, completed };
}

function track(api, params) {
  const project = new Project(
    { numberOfMedia: 1, positivePrompt: 'a lighthouse at dusk', steps: 4, ...params },
    { api, logger: SILENT_LOGGER }
  );
  api.projects.push(project);
  project.data.startedAt = new Date(Date.now() - 60_000);
  return project;
}

function result(jobID, imgID, extra = {}) {
  return {
    jobID,
    imgID,
    performedStepCount: 4,
    lastSeed: '7',
    triggeredNSFWFilter: false,
    userCanceled: false,
    ...extra
  };
}

async function deliver(socket, frame) {
  socket.emit('jobResult', frame);
  await sleep(10);
}

function stopTimers(api) {
  for (const project of api.projects) {
    if (project._timeout) clearInterval(project._timeout);
    for (const job of project.jobs) job._stopRuntimeTimeout?.();
  }
}

// A result for a project this client does not track, whose frame says nothing
// about its media, asks no endpoint. The old behaviour asked the image endpoint.
async function checkUntrackedWithoutEvidenceAsksNothing() {
  const { socket, calls, completed } = makeHarness();
  await deliver(socket, result('OTHER-TAB-1', 'IMG-1'));
  assert.deepEqual(calls, [], 'no evidence must not become an image request');
  assert.equal(completed.length, 1, 'the completion is still announced');
  assert.equal(completed[0].resultUrl, null);

  // A failed upload is not evidence of anything either.
  const second = makeHarness();
  await deliver(
    second.socket,
    result('OTHER-TAB-2', 'IMG-2', { artifacts: [{ contentType: 'video/mp4', success: false }] })
  );
  assert.deepEqual(second.calls, []);
}

// An untracked result whose frame names its media goes to that media's endpoint.
async function checkUntrackedResultUsesFrameEvidence() {
  const cases = [
    {
      frame: { artifacts: [{ file: 'out.mp4', contentType: 'video/mp4', success: true }] },
      expected: { path: MEDIA_PATH, query: { jobId: 'P', id: 'J', type: 'complete' } }
    },
    {
      // A still beside the video is incidental; the video is the result.
      frame: {
        artifacts: [
          { contentType: 'image/png', success: true },
          { contentType: 'video/mp4', success: true }
        ]
      },
      expected: { path: MEDIA_PATH, query: { jobId: 'P', id: 'J', type: 'complete' } }
    },
    {
      frame: { artifacts: [{ contentType: 'audio/mpeg', success: true }] },
      expected: {
        path: MEDIA_PATH,
        query: { jobId: 'P', id: 'J', type: 'complete', contentType: 'audio/mpeg' }
      }
    },
    {
      frame: { artifacts: [{ contentType: 'model/gltf-binary', success: true }] },
      expected: {
        path: MEDIA_PATH,
        query: { jobId: 'P', id: 'J', type: 'complete', contentType: 'model/gltf-binary' }
      }
    },
    {
      frame: { outputFormat: 'mp4' },
      expected: { path: MEDIA_PATH, query: { jobId: 'P', id: 'J', type: 'complete' } }
    },
    {
      frame: { outputFormat: 'wav' },
      expected: {
        path: MEDIA_PATH,
        query: { jobId: 'P', id: 'J', type: 'complete', contentType: 'audio/wav' }
      }
    },
    {
      // An image result keeps the image endpoint, exactly as before.
      frame: { artifacts: [{ contentType: 'image/jpeg', success: true }] },
      expected: { path: IMAGE_PATH, query: { jobId: 'P', imageId: 'J', type: 'complete' } }
    }
  ];
  for (const { frame, expected } of cases) {
    const { socket, calls, completed } = makeHarness();
    await deliver(socket, result('P', 'J', frame));
    assert.deepEqual(calls, [expected], `frame ${JSON.stringify(frame)}`);
    assert.equal(completed[0].resultUrl, `https://cdn.test${expected.path}/P/J`);
  }
}

// A catalog entry with no media kind is no evidence: the SDK's own knowledge
// of the model id decides, not a default of "image".
async function checkCatalogEntryWithoutMediaKind() {
  const modelId = 'wan_v2.2-14b-fp8_i2v_lightx2v';
  const { api, socket, calls } = makeHarness({
    catalog: [{ id: modelId, name: 'WAN i2v', SID: 1, tier: 't' }]
  });
  assert.equal(api.isVideoModelId(modelId), true);
  const project = track(api, { type: 'video', modelId });
  await deliver(socket, result(project.id, 'IMG-V'));
  assert.deepEqual(calls, [
    { path: MEDIA_PATH, query: { jobId: project.id, id: 'IMG-V', type: 'complete' } }
  ]);
  assert.equal(project.job('IMG-V').type, 'video');
  stopTimers(api);
}

// A model neither the catalog nor the SDK knows takes the type the project was
// created with, instead of defaulting to image.
async function checkUnknownModelUsesProjectType() {
  {
    const { api, socket, calls } = makeHarness({ catalog: [] });
    const project = track(api, { type: 'video', modelId: 'future_video_model_v1' });
    await deliver(socket, result(project.id, 'IMG-FV'));
    assert.deepEqual(calls, [
      { path: MEDIA_PATH, query: { jobId: project.id, id: 'IMG-FV', type: 'complete' } }
    ]);
    assert.equal(project.job('IMG-FV').type, 'video');
    stopTimers(api);
  }
  {
    const { api, socket, calls } = makeHarness({ catalog: [] });
    const project = track(api, {
      type: 'audio',
      modelId: 'future_audio_model_v1',
      outputFormat: 'flac'
    });
    await deliver(socket, result(project.id, 'IMG-FA'));
    assert.deepEqual(calls, [
      {
        path: MEDIA_PATH,
        query: { jobId: project.id, id: 'IMG-FA', type: 'complete', contentType: 'audio/flac' }
      }
    ]);
    stopTimers(api);
  }
}

// Image and GPT Image results are unchanged: the image endpoint with the
// project's content type, and a frame's own URL used as-is.
async function checkImageBehaviourUnchanged() {
  const { api, socket, calls, completed } = makeHarness({
    catalog: [
      { id: 'flux1-schnell-fp8', name: 'Flux', SID: 1, tier: 't', media: 'image' },
      { id: 'gpt-image-2', name: 'GPT Image', SID: 2, tier: 't', media: 'image' }
    ]
  });
  const image = track(api, { type: 'image', modelId: 'flux1-schnell-fp8', outputFormat: 'webp' });
  await deliver(socket, result(image.id, 'IMG-I'));
  assert.deepEqual(calls, [
    {
      path: IMAGE_PATH,
      query: { jobId: image.id, imageId: 'IMG-I', type: 'complete', contentType: 'image/webp' }
    }
  ]);

  const gpt = track(api, { type: 'image', modelId: 'gpt-image-2' });
  await deliver(
    socket,
    result(gpt.id, 'IMG-G', { resultUrl: 'https://vendor.test/gpt.png', outputFormat: 'png' })
  );
  assert.equal(calls.length, 1, 'a frame that carries its URL mints nothing');
  assert.equal(completed.at(-1).resultUrl, 'https://vendor.test/gpt.png');

  // The Pixal3D rule still outranks a catalog that calls the model an image.
  api._supportedModels = {
    data: [{ id: 'pixal3d_int8_i23d', name: 'Pixal3D', SID: 3, tier: 't', media: 'image' }],
    updatedAt: new Date()
  };
  const glb = track(api, { type: 'image', modelId: 'pixal3d_int8_i23d' });
  await deliver(socket, result(glb.id, 'IMG-3D'));
  assert.deepEqual(calls.at(-1), {
    path: MEDIA_PATH,
    query: { jobId: glb.id, id: 'IMG-3D', type: 'complete', contentType: 'model/gltf-binary' }
  });
  stopTimers(api);
}

// The API's "This result is media" 404 switches to the media endpoint once, and
// the image endpoint is never asked for that result again, even when the media
// request fails and the URL is requested later.
async function checkMediaRefusalSwitchesOnce() {
  let mediaFails = true;
  const { api, socket, calls, completed } = makeHarness({
    catalog: [{ id: 'flux1-schnell-fp8', name: 'Flux', SID: 1, tier: 't', media: 'image' }],
    respond(path, query) {
      if (path === IMAGE_PATH) throw MEDIA_REFUSAL;
      if (mediaFails) throw new ApiError(500, { status: 'error', errorCode: 1, message: 'boom' });
      return `https://cdn.test${path}/${query.jobId}/${query.id}`;
    }
  });
  const project = track(api, { type: 'image', modelId: 'flux1-schnell-fp8' });
  await deliver(socket, result(project.id, 'IMG-M'));
  assert.deepEqual(
    calls.map((call) => call.path),
    [IMAGE_PATH, MEDIA_PATH],
    'one image request, then one media request'
  );
  assert.deepEqual(calls[1].query, { jobId: project.id, id: 'IMG-M', type: 'complete' });
  assert.equal(completed[0].resultUrl, null, 'a failed media request leaves no URL');

  mediaFails = false;
  const job = project.job('IMG-M');
  const url = await job.getResultUrl();
  assert.equal(url, `https://cdn.test${MEDIA_PATH}/${project.id}/IMG-M`);
  assert.deepEqual(
    calls.map((call) => call.path),
    [IMAGE_PATH, MEDIA_PATH, MEDIA_PATH],
    'a later request goes straight to the media endpoint'
  );
  stopTimers(api);

  // The fallback delivers the URL on the first try when the media endpoint answers.
  const second = makeHarness({
    respond(path, query) {
      if (path === IMAGE_PATH) throw MEDIA_REFUSAL;
      return `https://cdn.test${path}/${query.jobId}/${query.id}`;
    }
  });
  await deliver(
    second.socket,
    result('OTHER-TAB-3', 'IMG-X', { artifacts: [{ contentType: 'image/png', success: true }] })
  );
  assert.deepEqual(
    second.calls.map((call) => call.path),
    [IMAGE_PATH, MEDIA_PATH]
  );
  assert.equal(second.completed[0].resultUrl, `https://cdn.test${MEDIA_PATH}/OTHER-TAB-3/IMG-X`);
}

// Any other image failure is surfaced as before and never retried on the media
// endpoint, which would sign a key for a file that does not exist.
async function checkOtherImageFailureDoesNotFallBack() {
  const { api, socket, calls, completed } = makeHarness({
    catalog: [{ id: 'flux1-schnell-fp8', name: 'Flux', SID: 1, tier: 't', media: 'image' }],
    respond() {
      throw new ApiError(404, { status: 'error', errorCode: 122, message: 'Download not found' });
    }
  });
  const project = track(api, { type: 'image', modelId: 'flux1-schnell-fp8' });
  await deliver(socket, result(project.id, 'IMG-N'));
  assert.deepEqual(
    calls.map((call) => call.path),
    [IMAGE_PATH]
  );
  assert.equal(completed[0].resultUrl, null);
  stopTimers(api);
}

function checkResultMediaEvidence() {
  assert.equal(resultMediaEvidence({}), undefined);
  assert.equal(resultMediaEvidence({ outputFormat: 'constructor' }), undefined);
  assert.equal(resultMediaEvidence({ artifacts: 'nope', outputFormat: 7 }), undefined);
  assert.deepEqual(
    resultMediaEvidence({ artifacts: [{ contentType: 'Audio/MPEG; codecs=mp3', success: true }] }),
    { kind: 'audio', contentType: 'Audio/MPEG; codecs=mp3' }
  );
  assert.deepEqual(
    resultMediaEvidence({ artifacts: [{ contentType: 'text/plain' }], outputFormat: 'MOV' }),
    { kind: 'video' }
  );
}

/**
 * Live media models whose ids the fallback guess used to misread as images when the
 * catalog was not loaded (checked against socket.sogni.ai/api/v1/models/list, 2026-09-25).
 */
function checkModelIdFallbackKnowsLiveMediaIds() {
  assert.equal(isVideoModel('wan_v2.2-14b-fp8_s2v'), true);
  assert.equal(isVideoModel('wan_v2.2-14b-fp8_s2v_lightx2v'), true);
  for (const id of [
    'qwen3_tts_1.7b_custom_voice_bf16',
    'qwen3_tts_1.7b_voice_clone_bf16',
    'qwen3_tts_1.7b_voice_design_bf16'
  ]) {
    assert.equal(isAudioModel(id), true, id);
    assert.equal(isVideoModel(id), false, id);
  }
  assert.equal(isAudioModel('flux1-schnell-fp8'), false);
  assert.equal(isVideoModel('flux1-schnell-fp8'), false);
}

async function main() {
  checkModelIdFallbackKnowsLiveMediaIds();
  checkResultMediaEvidence();
  await checkUntrackedWithoutEvidenceAsksNothing();
  await checkUntrackedResultUsesFrameEvidence();
  await checkCatalogEntryWithoutMediaKind();
  await checkUnknownModelUsesProjectType();
  await checkImageBehaviourUnchanged();
  await checkMediaRefusalSwitchesOnce();
  await checkOtherImageFailureDoesNotFallBack();
  console.log('Result download endpoint checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
