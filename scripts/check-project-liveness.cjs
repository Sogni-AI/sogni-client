/**
 * Regression tests for the project staleness watchdog.
 *
 * A project's id is minted client-side and lives only in sogni-socket until it
 * finishes; sogni-api stores it at completion. So `GET /v1/projects/:id` 404s
 * for the whole pending/queued/rendering window, and a bare 404 cannot mean
 * "lost". Liveness comes from the socket's artist-scoped active-projects
 * endpoint; the REST record only answers "it finished while you weren't
 * listening".
 *
 * Runs against compiled `dist/` output, like the sibling check-* scripts.
 */

'use strict';

const assert = require('node:assert/strict');

const Project = require('../dist/Projects/Project.js').default;
const ProjectsApi = require('../dist/Projects/index.js').default;

const SILENT_LOGGER = { info() {}, warn() {}, error() {}, debug() {} };

class ApiStub {
  constructor({
    liveProjectIds = null,
    restError = null,
    restProject = null,
    statusError,
    statusProject
  } = {}) {
    this.liveProjectIds = liveProjectIds;
    this.restError = restError;
    this.restProject = restProject;
    this.timedOutProjectIds = [];
    this.listCallCount = 0;
    this.getCallCount = 0;
    this.statusError = statusError ?? Object.assign(new Error('Not Found'), { status: 404 });
    this.statusProject = statusProject;
    this.statusCallCount = 0;
    this.client = {};
    this._recoveryTuning = {};
  }

  async _listActiveProjectIds() {
    this.listCallCount++;
    return this.liveProjectIds;
  }

  async get() {
    this.getCallCount++;
    if (this.restError) throw this.restError;
    return this.restProject;
  }

  async _notifyProjectTimedOut(projectId) {
    this.timedOutProjectIds.push(projectId);
  }

  resolveMissing = ProjectsApi.prototype.resolveMissing;
  _lookupUnlistedProject = ProjectsApi.prototype._lookupUnlistedProject;
  _resendUndelivered = async () => false;
  _recentlyResubmitted = () => false;
  async getStatus() {
    this.statusCallCount++;
    if (this.statusProject) return this.statusProject;
    throw this.statusError;
  }
}

const notFound = () => Object.assign(new Error('Not Found'), { status: 404 });
const serverError = () => Object.assign(new Error('Boom'), { status: 500 });

function makeProject(api) {
  const project = new Project(
    { type: 'video', modelId: 'minimax-h3-fl2va-fp8_t2v', numberOfMedia: 1, positivePrompt: 'x' },
    { api, logger: SILENT_LOGGER }
  );
  // The constructor starts a 2-minute interval; the tests drive the check
  // directly, so stop the timer to keep the process from hanging.
  project._stopTimeoutWatch?.();
  if (project._timeout) {
    clearInterval(project._timeout);
    project._timeout = null;
  }
  // Backdate so the staleness branch is the one under test.
  project.lastUpdated = new Date(Date.now() - 10 * 60 * 1000);
  return project;
}

// Drives the private staleness check the interval would call.
const runCheck = (project) => project._runStalenessCheck();

async function main() {
  // 1. Socket says the project is still in flight -> never cancel, never strike.
  {
    const api = new ApiStub({ liveProjectIds: [], restError: notFound() });
    const project = makeProject(api);
    api.liveProjectIds = [project.id];

    const before = project.lastUpdated.getTime();
    await runCheck(project);

    assert.equal(api.getCallCount, 0, 'a live project must not need the REST record at all');
    assert.equal(api.timedOutProjectIds.length, 0, 'a live project must never be cancelled');
    assert.ok(project.lastUpdated.getTime() > before, 'a live project refreshes its keepalive');
    assert.notEqual(project.status, 'failed');
  }

  // 2. The regression that started this: queued project, REST 404, liveness
  //    unknown (older socket / unauthenticated). Must NOT self-cancel.
  {
    const api = new ApiStub({ liveProjectIds: null, restError: notFound() });
    const project = makeProject(api);

    for (let i = 0; i < 5; i++) {
      // eslint-disable-next-line no-await-in-loop
      await runCheck(project);
    }

    assert.equal(
      api.timedOutProjectIds.length,
      0,
      'unknown liveness + 404 must never cancel a healthy queued project'
    );
    assert.notEqual(project.status, 'failed');
  }

  // 3. Socket confirms the project is gone AND REST has no record -> genuinely
  //    lost, so the strike counter runs and the project fails.
  {
    const api = new ApiStub({ liveProjectIds: ['someone-elses-project'], restError: notFound() });
    const project = makeProject(api);

    for (let i = 0; i < 3; i++) {
      // eslint-disable-next-line no-await-in-loop
      await runCheck(project);
    }

    assert.deepEqual(
      api.timedOutProjectIds,
      [project.id],
      'a project absent from the socket and from REST is lost and must be reported'
    );
    assert.equal(project.status, 'failed');
  }

  // 4. Non-404 REST failures are inconclusive and must never cancel work.
  {
    const api = new ApiStub({ liveProjectIds: null, restError: serverError() });
    const project = makeProject(api);

    for (let i = 0; i < 3; i++) {
      // eslint-disable-next-line no-await-in-loop
      await runCheck(project);
    }

    assert.notEqual(project.status, 'failed', 'a server outage is not a project failure');
    assert.equal(api.timedOutProjectIds.length, 0);
  }

  // Inconclusive owner lookups must also survive repeated watchdog checks.
  for (const statusError of [
    Object.assign(new Error('Unavailable'), { status: 503 }),
    Object.assign(new Error('Rate limited'), { status: 429, retryAfter: 30 }),
    Object.assign(new Error('Unauthorized'), { status: 401 }),
    new TypeError('Load failed')
  ]) {
    const api = new ApiStub({ liveProjectIds: [], restError: notFound(), statusError });
    const project = makeProject(api);
    project._failedSyncAttempts = 2;
    for (let i = 0; i < 5; i++) await runCheck(project);
    assert.equal(project.status, 'pending');
    assert.equal(project._failedSyncAttempts, 0, 'unknown breaks consecutive loss strikes');
    assert.equal(api.timedOutProjectIds.length, 0);
    assert.equal(api.statusCallCount, 5, 'one owner lookup per staleness check');
  }

  for (const status of ['queued', 'failed', 'canceled']) {
    const api = new ApiStub({ liveProjectIds: [], restError: notFound() });
    const project = makeProject(api);
    const params = project.params;
    api.statusProject = {
      id: project.id,
      status,
      finished: status !== 'queued',
      workerJobs: [],
      completedWorkerJobs: []
    };
    await runCheck(project);
    assert.equal(project.status, status === 'queued' ? 'pending' : status);
    assert.deepEqual(project.params, params, 'compact status must preserve generation settings');
    assert.equal(api.getCallCount, 1, 'the recovered snapshot is applied without rereading REST');
    assert.equal(api.timedOutProjectIds.length, 0);
  }

  {
    const api = new ApiStub({ liveProjectIds: [], restError: notFound() });
    const project = makeProject(api);
    project._failedSyncAttempts = 2;
    api.getStatus = async () => {
      project._update({ status: 'completed' });
      throw notFound();
    };
    await runCheck(project);
    assert.equal(project.status, 'completed', 'a live completion wins a delayed absence verdict');
    assert.equal(api.timedOutProjectIds.length, 0);
  }

  // 5. A project that completed while the socket was quiet is recovered from
  //    REST rather than cancelled.
  {
    const api = new ApiStub({
      liveProjectIds: [],
      restProject: {
        id: 'server-id',
        status: 'completed',
        completedWorkerJobs: [],
        queuePosition: -1,
        params: {}
      }
    });
    const project = makeProject(api);

    await runCheck(project);

    assert.equal(api.getCallCount, 1, 'absent from the socket -> ask REST whether it finished');
    assert.equal(api.timedOutProjectIds.length, 0, 'a completed project must not be cancelled');
  }

  console.log('check-project-liveness: ALL TESTS PASSED');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
