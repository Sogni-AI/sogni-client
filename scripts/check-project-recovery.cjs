/**
 * Regression tests for project recovery across socket drops, refreshes and
 * shared-socket tabs.
 *
 * The server keeps rendering while an artist socket is down and hands the
 * project back on reconnect (`authenticated.activeProjects` /
 * `unclaimedCompletedProjects`, or `GET /api/v1/artist/projects/sync`). The SDK
 * must: never fail a project just because the transport dropped; replay the
 * frames it missed so tracked instances and API-level listeners converge;
 * rebuild projects it never saw; and only declare a project lost when the
 * socket no longer lists it AND the REST API has no record.
 *
 * Runs against compiled `dist/` output, like the sibling check-* scripts.
 */

'use strict';

const assert = require('node:assert/strict');

const ProjectsApi = require('../dist/Projects/index.js').default;
const Project = require('../dist/Projects/Project.js').default;
const { isProjectLostError } = require('../dist/Projects/recovery.js');

const SILENT_LOGGER = { info() {}, warn() {}, error() {}, debug() {} };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const b64 = (obj) => Buffer.from(JSON.stringify(obj), 'utf8').toString('base64');

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
  listenerCount(event) {
    return (this.listeners.get(event) ?? []).length;
  }
}

/**
 * Stub of the ApiClient surface ProjectsApi touches: the socket (events + the
 * socket-host HTTP `get`), client-level connection events, and the REST client.
 */
function makeHarness({ restProjects = {}, syncSnapshot = null } = {}) {
  const socket = new Emitter();
  socket.sent = [];
  socket.send = async (type, data) => {
    socket.sent.push({ type, data });
  };
  socket.getCalls = [];
  socket.get = async (path, query) => {
    socket.getCalls.push({ path, query });
    if (path === '/api/v1/artist/projects/sync') {
      if (!syncSnapshot) throw Object.assign(new Error('Unauthorized'), { status: 401 });
      return syncSnapshot;
    }
    throw Object.assign(new Error('Not Found'), { status: 404 });
  };

  const client = new Emitter();
  client.socket = socket;
  client.appId = 'app-under-test';
  client.logger = SILENT_LOGGER;
  client.rest = {
    calls: [],
    async get(path, query) {
      this.calls.push({ path, query });
      const projectMatch = path.match(/^\/v1\/projects\/(.+)$/);
      if (projectMatch) {
        const project = restProjects[projectMatch[1]];
        if (!project) throw Object.assign(new Error('Not Found'), { status: 404 });
        return { status: 'success', data: { project } };
      }
      if (path === '/v1/image/downloadUrl' || path === '/v1/media/downloadUrl') {
        return {
          status: 'success',
          data: { downloadUrl: `https://cdn.test/${query.jobId}/${query.imageId || query.id}` }
        };
      }
      throw Object.assign(new Error('Not Found'), { status: 404 });
    }
  };

  const api = new ProjectsApi({ client, eip712: {} });
  api._recoveryTuning = {
    authenticatedGraceMs: 20,
    recentlyCreatedGraceMs: 0,
    missingProjectAttempts: 2,
    missingProjectRetryMs: 5
  };
  // Make `_listActiveProjectIds` (staleness watchdog) inert for these tests.
  api._listActiveProjectIds = async () => null;

  const apiEvents = [];
  api.on('project', (e) => apiEvents.push({ kind: 'project', ...e }));
  api.on('job', (e) => apiEvents.push({ kind: 'job', ...e }));
  const synced = [];
  api.on('projectsSynced', (r) => synced.push(r));
  const recoveredActive = [];
  api.on('activeProjectsRecovered', (list) => recoveredActive.push(...list));
  const recoveredCompleted = [];
  api.on('completedProjectsRecovered', (list) => recoveredCompleted.push(...list));

  return { api, socket, client, apiEvents, synced, recoveredActive, recoveredCompleted };
}

/**
 * Create a tracked project the way `create()` does after the request is sent,
 * without the model-option lookups and asset uploads that need a network.
 */
async function createTracked(api, overrides = {}) {
  const project = new Project(
    {
      type: 'image',
      modelId: 'flux1-schnell-fp8',
      numberOfMedia: 1,
      positivePrompt: 'a lighthouse at dusk',
      steps: 4,
      ...overrides
    },
    { api, logger: SILENT_LOGGER }
  );
  api.projects.push(project);
  // The grace window is zero in tests, but keep the intent explicit.
  project.data.startedAt = new Date(Date.now() - 60_000);
  return project;
}

function recoveredProject(id, overrides = {}) {
  return {
    id,
    appId: 'app-under-test',
    appSource: 'test',
    jobType: 'image',
    model: { id: 'flux1-schnell-fp8', SID: 1, name: 'Flux Schnell', type: 'image' },
    imageCount: 1,
    stepCount: 4,
    previewCount: 0,
    createTime: Date.now() - 30_000,
    updateTime: Date.now() - 1000,
    endTime: null,
    status: 'progress',
    reason: null,
    network: 'fast',
    tokenType: 'spark',
    jobCountCompletedByState: { completed: 0, completedPartial: 0, errored: 0, cancelled: 0 },
    clientRequestData: b64({
      numberOfImages: 1,
      previews: 0,
      disableSafety: false,
      outputFormat: 'png',
      keyFrames: [
        { modelID: 'flux1-schnell-fp8', positivePrompt: 'a lighthouse at dusk', steps: 4, seed: 7 }
      ]
    }),
    workerJobs: [],
    completedWorkerJobs: [],
    ...overrides
  };
}

function inFlightJob(projectId, imgID, performedSteps) {
  return {
    id: projectId,
    imgID,
    worker: { username: 'gpu-bob' },
    status: 'jobStarted',
    reason: '',
    performedSteps,
    triggeredNSFWFilter: false,
    seedUsed: -1
  };
}

function completedJob(projectId, imgID, seed = 42) {
  return {
    id: projectId,
    imgID,
    worker: { username: 'gpu-bob' },
    status: 'jobCompleted',
    reason: 'jobCompleted',
    performedSteps: 4,
    triggeredNSFWFilter: false,
    seedUsed: seed
  };
}

function stopTimers(api) {
  for (const project of api.trackedProjects) {
    if (project._timeout) {
      clearInterval(project._timeout);
      project._timeout = null;
    }
    for (const job of project.jobs) job._stopRuntimeTimeout?.();
  }
}

async function main() {
  // 1. A transport drop must not fail tracked projects, and timeouts defer.
  {
    const { api, client, apiEvents } = makeHarness();
    const project = await createTracked(api);
    client.emit('disconnected', { code: 1006, reason: '' });
    assert.equal(project.status, 'pending', 'disconnect must not fail the project');
    assert.equal(api._shouldDeferProjectTimeouts(), true, 'timeouts defer while disconnected');
    assert.equal(
      apiEvents.filter((e) => e.kind === 'project' && e.type === 'error').length,
      0,
      'no synthetic error events on disconnect'
    );
    client.emit('connected', { network: 'fast' });
    assert.equal(api._shouldDeferProjectTimeouts(), false, 'timeouts resume on reconnect');
    stopTimers(api);
  }

  // 2. `authenticated` with an in-flight snapshot replays the missed frames for a
  //    tracked project, through the regular handlers.
  {
    const { api, socket, client, apiEvents, synced } = makeHarness();
    const project = await createTracked(api);
    client.emit('connected', { network: 'fast' });
    socket.emit('authenticated', {
      clientType: 'artist',
      activeProjects: [
        recoveredProject(project.id, { workerJobs: [inFlightJob(project.id, 'IMG-1', 2)] })
      ],
      unclaimedCompletedProjects: []
    });
    await sleep(30);
    assert.equal(synced.length, 1, 'one projectsSynced per authenticated frame');
    assert.deepEqual(synced[0].active, [project.id]);
    assert.equal(synced[0].reason, 'authenticated');
    assert.equal(project.status, 'processing');
    const job = project.job('IMG-1');
    assert.ok(job, 'the in-flight job was created on the tracked project');
    assert.equal(job.status, 'processing');
    assert.equal(job.step, 2);
    assert.equal(job.stepCount, 4);
    assert.equal(job.workerName, 'gpu-bob');
    const kinds = apiEvents.map((e) => `${e.kind}:${e.type}`);
    assert.ok(kinds.includes('job:started'), `API-level started event replayed: ${kinds}`);
    assert.ok(kinds.includes('job:progress'), `API-level progress event replayed: ${kinds}`);
    // The grace timer must not also fetch the snapshot once `authenticated` arrived.
    await sleep(40);
    assert.equal(socket.getCalls.length, 0, 'no HTTP sync when the frame arrived in time');
    stopTimers(api);
  }

  // 3. A tracked project that finished while away completes with a minted URL,
  //    and both the instance and API-level listeners see completion.
  {
    const { api, socket, client, apiEvents } = makeHarness();
    const project = await createTracked(api);
    let completedUrls = null;
    project.on('completed', (urls) => {
      completedUrls = urls;
    });
    client.emit('connected', { network: 'fast' });
    socket.emit('authenticated', {
      clientType: 'artist',
      activeProjects: [],
      unclaimedCompletedProjects: [
        recoveredProject(project.id, {
          status: 'completed',
          reason: 'allJobsCompleted',
          completedWorkerJobs: [completedJob(project.id, 'IMG-1', 99)]
        })
      ]
    });
    await sleep(30);
    assert.equal(project.status, 'completed');
    assert.deepEqual(completedUrls, [`https://cdn.test/${project.id}/IMG-1`]);
    assert.equal(project.job('IMG-1').seed, 99);
    const jobCompleted = apiEvents.find((e) => e.kind === 'job' && e.type === 'completed');
    assert.ok(jobCompleted, 'API-level job completed event replayed');
    assert.equal(jobCompleted.resultUrl, `https://cdn.test/${project.id}/IMG-1`);
    assert.ok(
      apiEvents.some((e) => e.kind === 'project' && e.type === 'completed'),
      'API-level project completed event replayed'
    );
    stopTimers(api);
  }

  // 4. An in-flight project this client never saw is rebuilt, tracked and announced.
  {
    const { api, socket, client, recoveredActive } = makeHarness();
    client.emit('connected', { network: 'fast' });
    socket.emit('authenticated', {
      clientType: 'artist',
      activeProjects: [
        recoveredProject('REBUILT-1', { workerJobs: [inFlightJob('REBUILT-1', 'IMG-A', 1)] })
      ],
      unclaimedCompletedProjects: []
    });
    await sleep(30);
    const project = api.trackedProjects.find((p) => p.id === 'REBUILT-1');
    assert.ok(project, 'rebuilt project is tracked');
    assert.equal(project.recovered, true);
    assert.equal(project.params.positivePrompt, 'a lighthouse at dusk');
    assert.equal(project.params.modelId, 'flux1-schnell-fp8');
    assert.equal(project.params.type, 'image');
    assert.equal(project.params.seed, 7);
    assert.equal(project.status, 'processing');
    assert.equal(project.job('IMG-A')?.step, 1);
    assert.equal(recoveredActive.length, 1);
    assert.equal(recoveredActive[0].id, 'REBUILT-1');
    // Live frames now route to it like any created project.
    socket.emit('jobProgress', { jobID: 'REBUILT-1', imgID: 'IMG-A', step: 3, stepCount: 4 });
    assert.equal(project.job('IMG-A').step, 3);
    stopTimers(api);
  }

  // 5. A finished project this client never saw is announced once, with URLs,
  //    even when the read-only sync route reports it again.
  {
    const { api, socket, client, recoveredCompleted } = makeHarness();
    const frame = {
      clientType: 'artist',
      activeProjects: [],
      unclaimedCompletedProjects: [
        recoveredProject('DONE-1', {
          status: 'completed',
          reason: 'allJobsCompleted',
          imageCount: 2,
          completedWorkerJobs: [completedJob('DONE-1', 'IMG-A'), completedJob('DONE-1', 'IMG-B')]
        })
      ]
    };
    client.emit('connected', { network: 'fast' });
    socket.emit('authenticated', frame);
    await sleep(30);
    assert.equal(recoveredCompleted.length, 1);
    assert.deepEqual(recoveredCompleted[0].resultUrls, [
      'https://cdn.test/DONE-1/IMG-A',
      'https://cdn.test/DONE-1/IMG-B'
    ]);
    assert.equal(recoveredCompleted[0].model.type, 'image');
    const project = api.trackedProjects.find((p) => p.id === 'DONE-1');
    assert.equal(project?.status, 'completed');
    socket.emit('authenticated', frame);
    await sleep(30);
    assert.equal(recoveredCompleted.length, 1, 'a repeated snapshot is not re-announced');
    stopTimers(api);
  }

  // 6. Tracked project absent from the snapshot: finished per REST -> completed;
  //    no REST record after retries -> lost.
  {
    const finishedId = null;
    const { api, socket, client, apiEvents, synced } = makeHarness({
      restProjects: {
        // filled in below once the project id is known
      }
    });
    const finished = await createTracked(api);
    const lost = await createTracked(api);
    const justCreated = await createTracked(api);
    justCreated.data.startedAt = new Date(); // inside the recently-created grace window
    api._recoveryTuning.recentlyCreatedGraceMs = 60_000;
    client.rest.get = (function (original) {
      return async function (path, query) {
        if (path === `/v1/projects/${finished.id}`) {
          return {
            status: 'success',
            data: {
              project: recoveredProject(finished.id, {
                status: 'completed',
                reason: 'allJobsCompleted',
                completedWorkerJobs: [completedJob(finished.id, 'IMG-F')]
              })
            }
          };
        }
        return original.call(this, path, query);
      };
    })(client.rest.get);
    void finishedId;

    client.emit('connected', { network: 'fast' });
    socket.emit('authenticated', {
      clientType: 'artist',
      activeProjects: [],
      unclaimedCompletedProjects: []
    });
    await sleep(60);
    assert.equal(synced.length, 1);
    assert.deepEqual(synced[0].completed, [finished.id]);
    assert.deepEqual(synced[0].lost, [lost.id]);
    assert.equal(finished.status, 'completed');
    assert.equal(finished.resultUrls[0], `https://cdn.test/${finished.id}/IMG-F`);
    assert.equal(lost.status, 'failed');
    assert.ok(isProjectLostError(lost.toJSON().error), 'lost projects carry the projectLost code');
    const lostEvent = apiEvents.find(
      (e) => e.kind === 'project' && e.type === 'error' && e.projectId === lost.id
    );
    assert.ok(lostEvent && isProjectLostError(lostEvent.error), 'API-level error for lost project');
    assert.equal(justCreated.status, 'pending', 'a just-created project is not judged missing');
    assert.ok(
      !synced[0].lost.includes(justCreated.id) && !synced[0].completed.includes(justCreated.id)
    );
    stopTimers(api);
  }

  // 6b. Not in the snapshot and no REST record, but the socket lists it: the
  //     request landed after the snapshot was taken. Wait, do not fail.
  {
    const { api, socket, client, synced } = makeHarness();
    const late = await createTracked(api);
    api._listActiveProjectIds = async () => [late.id];
    client.emit('connected', { network: 'fast' });
    socket.emit('authenticated', {
      clientType: 'artist',
      activeProjects: [],
      unclaimedCompletedProjects: []
    });
    await sleep(60);
    assert.deepEqual(synced[0].lost, []);
    assert.deepEqual(synced[0].active, [late.id]);
    assert.equal(late.status, 'pending', 'a socket-listed project is never failed as lost');
    stopTimers(api);
  }

  // 6c. Cancelled while away reaches API-level listeners as an artistCanceled
  //     error and settles the instance on `canceled`.
  {
    const { api, socket, client, apiEvents } = makeHarness();
    const project = await createTracked(api);
    client.emit('connected', { network: 'fast' });
    socket.emit('authenticated', {
      clientType: 'artist',
      activeProjects: [],
      unclaimedCompletedProjects: [
        recoveredProject(project.id, { status: 'cancelled', reason: 'artistCanceled' })
      ]
    });
    await sleep(30);
    assert.equal(project.status, 'canceled');
    const errorEvent = apiEvents.find(
      (e) => e.kind === 'project' && e.type === 'error' && e.projectId === project.id
    );
    assert.equal(errorEvent?.error?.originalCode, 'artistCanceled');
    stopTimers(api);
  }

  // 7. Never downgrade: a stale in-flight snapshot leaves a finished project alone.
  {
    const { api, socket, client, synced } = makeHarness();
    const project = await createTracked(api);
    socket.emit('jobResult', {
      jobID: project.id,
      imgID: 'IMG-1',
      performedStepCount: 4,
      lastSeed: '5',
      triggeredNSFWFilter: false,
      userCanceled: false
    });
    await sleep(10);
    socket.emit('jobState', { type: 'jobCompleted', jobID: project.id });
    assert.equal(project.status, 'completed');
    client.emit('connected', { network: 'fast' });
    socket.emit('authenticated', {
      clientType: 'artist',
      activeProjects: [
        recoveredProject(project.id, { workerJobs: [inFlightJob(project.id, 'IMG-1', 1)] })
      ],
      unclaimedCompletedProjects: []
    });
    await sleep(30);
    assert.equal(project.status, 'completed', 'stale snapshot must not reopen the project');
    assert.equal(project.job('IMG-1').step, 4);
    assert.deepEqual(synced[0].active, [], 'finished projects are not reported active');
    stopTimers(api);
  }

  // 8. A tab sharing the socket sees `connected` but never `authenticated`: it
  //    pulls the snapshot over HTTP, scoped to its own app-id.
  {
    const { api, socket, client, synced, recoveredActive } = makeHarness({
      syncSnapshot: {
        activeProjects: [recoveredProject('SHARED-1', { status: 'queued' })],
        unclaimedCompletedProjects: [],
        serverTime: Date.now()
      }
    });
    client.emit('connected', { network: 'fast' });
    await sleep(60);
    assert.equal(socket.getCalls.length, 1, 'exactly one HTTP sync after the grace period');
    assert.equal(socket.getCalls[0].path, '/api/v1/artist/projects/sync');
    assert.deepEqual(socket.getCalls[0].query, { appId: 'app-under-test' });
    assert.equal(synced.length, 1);
    assert.equal(synced[0].reason, 'connected');
    assert.equal(recoveredActive[0]?.id, 'SHARED-1');
    assert.equal(api.trackedProjects.find((p) => p.id === 'SHARED-1')?.status, 'queued');
    stopTimers(api);
  }

  // 9. Manual sync is available to consumers and reports the raw snapshot.
  {
    const { api, synced } = makeHarness({
      syncSnapshot: { activeProjects: [], unclaimedCompletedProjects: [], serverTime: 1 }
    });
    const result = await api.sync();
    assert.equal(result.reason, 'manual');
    assert.deepEqual(result.snapshot.activeProjects, []);
    assert.equal(result.snapshot.serverTime, 1);
    assert.equal(synced.length, 1);
    stopTimers(api);
  }

  // 10. LLM entries in the snapshot are ignored: they are chat streams, not media projects.
  {
    const { api, socket, client, recoveredActive } = makeHarness();
    client.emit('connected', { network: 'fast' });
    socket.emit('authenticated', {
      clientType: 'artist',
      activeProjects: [
        recoveredProject('LLM-1', { jobType: 'llm', model: { id: 'qwen', type: 'llm' } })
      ],
      unclaimedCompletedProjects: []
    });
    await sleep(30);
    assert.equal(recoveredActive.length, 0);
    assert.equal(api.trackedProjects.length, 0);
    stopTimers(api);
  }

  console.log('check-project-recovery: ALL TESTS PASSED');
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
