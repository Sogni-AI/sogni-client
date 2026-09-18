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
const {
  MessageDeliveryUncertainError
} = require('../dist/ApiClient/WebSocketClient/requestDelivery.js');

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

  // 6d-6g. The owner-scoped lookup can confirm an in-flight project or a
  //     terminal failure/cancellation without a full result record. Successful
  //     completions still wait for that record so their media is not lost.
  {
    const liveLookup = async (answers) => {
      const { api, socket, client, synced, apiEvents } = makeHarness();
      const projects = {};
      for (const key of Object.keys(answers)) projects[key] = await createTracked(api);
      const v2Calls = [];
      client.rest.get = (function (original) {
        return async function (path, query) {
          const match = path.match(/^\/v2\/projects\/(.+)$/);
          if (match) {
            const id = decodeURIComponent(match[1]);
            v2Calls.push(id);
            const key = Object.keys(projects).find((name) => projects[name].id === id);
            const answer = answers[key];
            if (answer instanceof Error) throw answer;
            return { status: 'success', data: { project: { id, ...answer } } };
          }
          return original.call(this, path, query);
        };
      })(client.rest.get);
      client.emit('connected', { network: 'fast' });
      socket.emit('authenticated', {
        clientType: 'artist',
        activeProjects: [],
        unclaimedCompletedProjects: []
      });
      await sleep(80);
      return { api, projects, synced, v2Calls, apiEvents, socket, client };
    };
    const notFound = Object.assign(new Error('Not Found'), { status: 404 });
    const unauthorized = Object.assign(new Error('Unauthorized'), { status: 401 });
    const jobs = { workerJobs: [], completedWorkerJobs: [] };
    const { api, projects, synced, v2Calls, apiEvents, socket, client } = await liveLookup({
      queued: { status: 'queued', finished: false, ...jobs },
      processing: { status: 'processing', finished: false, ...jobs },
      gone: notFound,
      anonymous: unauthorized,
      settled: { status: 'completed', finished: true, ...jobs },
      failed: {
        status: 'failed',
        finished: true,
        statusOnly: true,
        reason: 'allJobsCompleted',
        ...jobs
      },
      canceled: { status: 'canceled', finished: true, statusOnly: true, ...jobs }
    });
    assert.deepEqual(
      [...synced[0].active].sort(),
      [projects.queued.id, projects.processing.id].sort(),
      'a project the live lookup reports in flight is active, not lost'
    );
    assert.equal(projects.queued.status, 'pending', 'a queued project is never failed as lost');
    assert.equal(projects.processing.status, 'pending');
    assert.deepEqual(
      [...synced[0].lost].sort(),
      [projects.gone.id, projects.anonymous.id].sort(),
      'a 404 or an unauthenticated lookup keeps the lost verdict'
    );
    assert.equal(projects.gone.status, 'failed');
    assert.deepEqual(
      synced[0].unverified,
      [projects.settled.id],
      'a successful answer without a stored record stays unverified'
    );
    assert.equal(projects.settled.status, 'pending', 'an unverified project is left untouched');
    assert.deepEqual(
      [...synced[0].completed].sort(),
      [projects.failed.id, projects.canceled.id].sort(),
      'known failures and cancellations are reconciled as finished'
    );
    assert.equal(projects.failed.status, 'failed');
    assert.equal(projects.canceled.status, 'canceled');
    assert.equal(projects.canceled.toJSON().error, undefined);
    assert.equal(projects.failed.toJSON().error.originalCode, 'genfailure');
    await assert.rejects(projects.failed.waitForCompletion());
    await assert.rejects(projects.canceled.waitForCompletion());
    const terminalEvents = () =>
      apiEvents.filter(
        (event) =>
          event.kind === 'project' &&
          event.type === 'error' &&
          [projects.failed.id, projects.canceled.id].includes(event.projectId)
      );
    assert.equal(terminalEvents().length, 2, 'API listeners receive both terminal outcomes');
    assert.equal(v2Calls.length, 7, 'one live lookup per unlisted project');
    assert.ok(!client.rest.calls.some(({ path }) => path.includes('downloadUrl')));

    // Stores without tracked Project instances can consume the compact status
    // without invented model, cost, or result metadata.
    const resolutions = await api.resolveMissing([projects.failed.id, projects.canceled.id]);
    assert.equal(resolutions[projects.failed.id].state, 'terminal');
    assert.equal(resolutions[projects.failed.id].project.status, 'failed');
    assert.equal(resolutions[projects.failed.id].project.costActual, undefined);
    assert.equal(resolutions[projects.canceled.id].state, 'terminal');
    assert.equal(resolutions[projects.canceled.id].project.status, 'canceled');

    socket.emit('authenticated', {
      clientType: 'artist',
      activeProjects: [],
      unclaimedCompletedProjects: []
    });
    await sleep(80);
    assert.equal(terminalEvents().length, 2, 'another sync never replays a settled outcome');
    stopTimers(api);
  }

  // Compact outcomes must settle the jobs this client already saw. Their
  // empty job arrays cannot repair those jobs through the full-record API.
  for (const status of ['failed', 'canceled']) {
    for (const hasCompletedJob of [false, true]) {
      const { api, socket, client, apiEvents } = makeHarness();
      const project = await createTracked(api, { numberOfMedia: hasCompletedJob ? 4 : 3 });
      let projectFailures = 0;
      let jobFailures = 0;
      project.on('failed', () => projectFailures++);
      project.on('jobFailed', () => jobFailures++);
      const waiting = project.waitForCompletion().then(
        () => assert.fail('a confirmed terminal failure must reject the completion wait'),
        (error) => error
      );
      if (hasCompletedJob) {
        await api.handleJobResult({
          jobID: project.id,
          imgID: 'DONE',
          resultUrl: 'https://cdn.test/preserved.png',
          triggeredNSFWFilter: false,
          userCanceled: false
        });
      }
      const completed = project.job('DONE')?.toJSON();
      for (const [id, state] of [
        ['RUNNING', 'processing'],
        ['LOADING', 'initiating'],
        ['RETRYING', 'pending']
      ]) {
        const job = project._addJob({
          id,
          projectId: project.id,
          status: 'pending',
          step: 1,
          stepCount: 4
        });
        job._update({ status: state });
        if (state === 'processing') assert.ok(job._runtimeTimeout, 'running jobs have a watchdog');
      }
      project._update({ status: 'processing' });
      const originalGet = client.rest.get.bind(client.rest);
      client.rest.get = async (path, query) => {
        if (path === `/v2/projects/${project.id}`) {
          return {
            status: 'success',
            data: {
              project: {
                id: project.id,
                status,
                finished: true,
                reason: status === 'failed' ? 'allJobsCompleted' : 'artistCanceled',
                workerJobs: [],
                completedWorkerJobs: []
              }
            }
          };
        }
        return originalGet(path, query);
      };
      const snapshot = { activeProjects: [], unclaimedCompletedProjects: [] };
      const result = await api._queueSync(snapshot, 'manual', Date.now());
      assert.equal(project.status, status);
      assert.deepEqual(result.completed, [project.id]);
      assert.equal(projectFailures, 1, 'the project failure lifecycle fires once');
      assert.equal(jobFailures, status === 'failed' ? 3 : 0);
      assert.ok((await waiting).message);
      for (const job of project.jobs.filter((job) => job.id !== 'DONE')) {
        assert.equal(job.status, status, `${job.id} must settle with its project`);
        assert.equal(job.finished, true);
        assert.equal(job._runtimeTimeout, null);
        assert.equal(job.error?.originalCode, status === 'failed' ? 'genfailure' : undefined);
      }
      assert.deepEqual(project.job('DONE')?.toJSON(), completed);
      assert.deepEqual(
        project.resultUrls,
        hasCompletedJob ? ['https://cdn.test/preserved.png'] : []
      );
      const jobErrors = () =>
        apiEvents.filter((event) => event.kind === 'job' && event.type === 'error');
      assert.equal(
        jobErrors().length,
        3,
        'API job observers receive each missing terminal outcome'
      );
      assert.equal(
        apiEvents.filter((event) => event.kind === 'project' && event.type === 'error').length,
        1
      );
      await api._queueSync(snapshot, 'manual', Date.now());
      assert.equal(jobErrors().length, 3, 'another sync does not repeat job terminal events');
      assert.equal(projectFailures, 1);
      // A delayed job error must not overwrite a confirmed cancellation or
      // media that was already delivered before recovery.
      for (const job of project.jobs) {
        socket.emit('jobError', {
          jobID: project.id,
          imgID: job.id,
          error: 'workerDisconnected',
          error_message: 'Worker disconnected',
          isFromWorker: true
        });
      }
      assert.equal(project.status, status);
      assert.deepEqual(project.job('DONE')?.toJSON(), completed);
      assert.ok(project.jobs.every((job) => job.id === 'DONE' || job.status === status));
      stopTimers(api);
    }
  }

  // 6h. A project the socket lists is never looked up again.
  {
    const { api, socket, client, synced } = makeHarness();
    const late = await createTracked(api);
    api._listActiveProjectIds = async () => [late.id];
    const v2Calls = [];
    client.rest.get = (function (original) {
      return async function (path, query) {
        if (path.startsWith('/v2/projects/')) v2Calls.push(path);
        return original.call(this, path, query);
      };
    })(client.rest.get);
    client.emit('connected', { network: 'fast' });
    socket.emit('authenticated', {
      clientType: 'artist',
      activeProjects: [],
      unclaimedCompletedProjects: []
    });
    await sleep(60);
    assert.deepEqual(synced[0].active, [late.id]);
    assert.deepEqual(v2Calls, [], 'the socket list answers first');
    stopTimers(api);
  }

  // 6i. getStatus reads the owner-scoped live lookup and returns it unchanged;
  //     get() still reads the terminal record.
  {
    const { api, client } = makeHarness();
    const seen = [];
    client.rest.get = async (path) => {
      seen.push(path);
      if (path === '/v2/projects/A%2FB') {
        return {
          status: 'success',
          data: {
            project: {
              id: 'A/B',
              status: 'queued',
              finished: false,
              workerJobs: [],
              completedWorkerJobs: []
            }
          }
        };
      }
      throw Object.assign(new Error('Not Found'), { status: 404 });
    };
    const status = await api.getStatus('A/B');
    assert.deepEqual(status, {
      id: 'A/B',
      status: 'queued',
      finished: false,
      workerJobs: [],
      completedWorkerJobs: []
    });
    await assert.rejects(api.get('A/B'), (error) => error.status === 404);
    assert.deepEqual(seen, ['/v2/projects/A%2FB', '/v1/projects/A/B'], 'get() keeps its v1 path');
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

  // 11. listProjectsElsewhere: other app instances only — never this instance,
  //     never LLM entries, never projects an older socket left untagged — and
  //     read-only (nothing becomes tracked).
  {
    const { api, socket } = makeHarness({
      syncSnapshot: {
        activeProjects: [
          recoveredProject('MINE', { appId: 'app-under-test' }),
          recoveredProject('PHONE', { appId: 'app-phone', appSource: 'sogni-ios' }),
          recoveredProject('CHAT-LLM', {
            appId: 'app-chat',
            jobType: 'llm',
            model: { id: 'qwen', type: 'llm' }
          }),
          recoveredProject('LEGACY', { appId: undefined })
        ],
        unclaimedCompletedProjects: [
          recoveredProject('DONE', { appId: 'app-phone', status: 'completed' })
        ]
      }
    });
    const elsewhere = await api.listProjectsElsewhere();
    assert.deepEqual(
      elsewhere.map((p) => p.id),
      ['PHONE'],
      'only in-flight projects from other app instances'
    );
    assert.equal(elsewhere[0].appSource, 'sogni-ios');
    assert.equal(socket.getCalls.at(-1).query?.appId, undefined, 'queried across all app-ids');
    assert.equal(api.trackedProjects.length, 0, 'read-only: nothing becomes tracked');
    stopTimers(api);
  }

  // 11. A recoverable drop (`connecting`, the socket-deploy path) defers
  //     timeouts too; `disconnected` is only emitted for terminal closes.
  {
    const { api, client } = makeHarness();
    await createTracked(api);
    client.emit('connecting', { network: 'fast' });
    assert.equal(api._shouldDeferProjectTimeouts(), true, 'timeouts defer while reconnecting');
    client.emit('connected', { network: 'fast' });
    assert.equal(api._shouldDeferProjectTimeouts(), false, 'timeouts resume on reconnect');
    stopTimers(api);
  }

  // 12. A request refused while the socket restarts (jobError 1001, no imgID)
  //     is not a failure: it is sent again, unchanged, on the next connection.
  {
    const { api, socket, client, apiEvents } = makeHarness();
    const project = await createTracked(api);
    const request = { jobID: project.id, keyFrames: [{ modelID: 'flux1-schnell-fp8' }] };
    api._unadmittedRequests.set(project.id, request);
    socket.emit('jobError', {
      jobID: project.id,
      isFromWorker: false,
      error: '1001',
      error_message: 'Server is restarting'
    });
    assert.equal(project.status, 'pending', 'a refusal during restart does not fail the project');
    assert.equal(socket.sent.length, 0, 'nothing is written into the closing socket');
    client.emit('connecting', { network: 'fast' });
    client.emit('connected', { network: 'fast' });
    await sleep(10);
    assert.deepEqual(socket.sent, [{ type: 'jobRequest', data: request }], 'resubmitted once');
    assert.equal(
      apiEvents.filter((e) => e.kind === 'project' && e.type === 'error').length,
      0,
      'no error surfaced'
    );
    // A second refusal is not retried again: it surfaces.
    api._unadmittedRequests.delete(project.id);
    socket.emit('jobError', {
      jobID: project.id,
      isFromWorker: false,
      error: '1001',
      error_message: 'Server is restarting'
    });
    assert.equal(project.status, 'failed', 'a request with nothing left to resubmit fails');
    if (api._recheckTimer) clearTimeout(api._recheckTimer);
    stopTimers(api);
  }

  // 13. A project too new to judge at the reconnect sync is re-checked once the
  //     grace ends, instead of waiting minutes for the staleness watchdog.
  {
    const { api, socket, client, synced } = makeHarness({
      syncSnapshot: { activeProjects: [], unclaimedCompletedProjects: [] }
    });
    api._recoveryTuning.recentlyCreatedGraceMs = 40;
    const project = await createTracked(api);
    project.data.startedAt = new Date();
    client.emit('connected', { network: 'fast' });
    socket.emit('authenticated', {
      clientType: 'artist',
      activeProjects: [],
      unclaimedCompletedProjects: []
    });
    await sleep(20);
    assert.equal(synced.length, 1);
    assert.deepEqual(synced[0].lost, [], 'too new to judge on the first sync');
    await sleep(400);
    const recheck = synced.find((r) => r.reason === 'recheck');
    assert.ok(recheck, 'a recheck sync ran after the grace');
    assert.deepEqual(recheck.lost, [project.id], 'the recheck resolves it');
    stopTimers(api);
  }

  // 14. A missing cross-tab ACK is ambiguous. Keep the original project ID,
  //     recover its status, and never submit a replacement generation.
  for (const admitted of [true, false]) {
    const snapshot = { activeProjects: [], unclaimedCompletedProjects: [] };
    const { api, socket, synced } = makeHarness({ syncSnapshot: snapshot });
    api.getModelOptions = async () => ({
      type: 'image',
      sampler: { allowed: [], default: null },
      scheduler: { allowed: [], default: null }
    });
    socket.send = async (type, data) => {
      socket.sent.push({ type, data });
      if (admitted) {
        snapshot.activeProjects.push(
          recoveredProject(data.jobID, {
            workerJobs: [inFlightJob(data.jobID, 'ACK-LOST-IMG', 2)]
          })
        );
      }
      throw new MessageDeliveryUncertainError();
    };
    const project = await api.create({
      type: 'image',
      modelId: 'flux1-schnell-fp8',
      numberOfMedia: 1,
      positivePrompt: 'a lighthouse at dusk',
      steps: 4
    });
    assert.equal(project.id, socket.sent[0].data.jobID, 'keep the submitted ID');
    assert.equal(api.trackedProjects[0], project, 'caller and recovery share the instance');
    assert.equal(project.status, 'pending', 'a lost ACK alone is not a failure');
    await sleep(350);
    assert.equal(synced.at(-1).reason, 'recheck', 'status recovery runs automatically');
    assert.equal(socket.sent.length, 1, 'recovery does not send a replacement request');
    if (admitted) {
      assert.equal(project.status, 'processing');
      assert.equal(project.job('ACK-LOST-IMG').step, 2, 'progress resumes on the original project');
    } else {
      assert.equal(project.status, 'failed', 'absence confirmed by recovery becomes a failure');
      assert.deepEqual(synced.at(-1).lost, [project.id]);
    }
    stopTimers(api);
  }

  // 15. A definitive send error still rejects create() and discards the local
  //     request. Only the missing-ACK error takes the recovery path.
  {
    const { api, socket } = makeHarness();
    api.getModelOptions = async () => ({
      type: 'image',
      sampler: { allowed: [], default: null },
      scheduler: { allowed: [], default: null }
    });
    socket.send = async () => {
      throw new Error('WebSocket connection failed');
    };
    await assert.rejects(
      api.create({
        type: 'image',
        modelId: 'flux1-schnell-fp8',
        numberOfMedia: 1,
        positivePrompt: 'a lighthouse at dusk',
        steps: 4
      }),
      /connection failed/
    );
    assert.equal(api.trackedProjects.length, 0);
    assert.equal(api._unadmittedRequests.size, 0);
    assert.equal(api._recheckTimer, null);
  }

  console.log('check-project-recovery: ALL TESTS PASSED');
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
