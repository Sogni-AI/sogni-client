/**
 * Regression checks for a render the server moves to another worker.
 *
 * The server moves a render on several paths -- a worker that failed (announced
 * with `jobRetry`), one that disconnected and never reclaimed its render, a
 * personal LoRA that went away (both silent). Each time the new worker mints a
 * NEW imgID, which is what the SDK reports as the job id.
 *
 * Two things break if the SDK treats that as a new render:
 *   1. the project gains a job it never asked for, and
 *   2. the abandoned attempt's job sits at `processing` with its runtime budget
 *      still running -- and when that expires, `_handleJobRuntimeTimeout` sends
 *      `artistCanceled` to the server and cancels the project, retry included.
 *
 * Runs against compiled `dist/` output.
 */

'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const Project = require('../dist/Projects/Project.js').default;
const ProjectsApi = require('../dist/Projects/index.js').default;

const SILENT_LOGGER = { info() {}, warn() {}, error() {}, debug() {} };

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
    this.logger = SILENT_LOGGER;
  }
}

function setup(params = {}) {
  const client = new ClientStub();
  const api = new ProjectsApi({ client, eip712: {} });
  const project = new Project(
    { type: 'video', modelId: 'test-model', numberOfMedia: 1, positivePrompt: 'x', network: 'fast', ...params },
    { api, logger: SILENT_LOGGER }
  );
  if (project._timeout) {
    clearInterval(project._timeout);
    project._timeout = null;
  }
  api.projects.push(project);
  const jobEvents = [];
  api.on('job', (event) => jobEvents.push(event));
  return { client, api, project, jobEvents };
}

const started = (client, project, imgID, jobIndex = 0) =>
  client.socket.emit('jobState', { type: 'jobStarted', jobID: project.id, imgID, jobIndex, workerName: `worker-${imgID}` });

const progress = (client, project, imgID, step) =>
  client.socket.emit('jobProgress', { jobID: project.id, imgID, step, stepCount: 20 });

const retry = (client, project, imgID, jobIndex = 0) =>
  client.socket.emit('jobRetry', {
    jobID: project.id,
    imgID,
    jobIndex,
    attempt: 1,
    maxAttempts: 1,
    isFromWorker: true,
    error: 'genfailure',
    error_message: 'Generation failed'
  });

const cancelsSent = (client) => client.socket.sent.filter(({ type, data }) => type === 'jobError' && data.error === 'artistCanceled');

function main() {
  // Announced retry: the job goes back to waiting, the project is untouched.
  {
    const { client, project, jobEvents } = setup();
    started(client, project, 'IMG-FIRST');
    const job = project.jobs[0];
    assert.equal(job.status, 'processing');
    assert.ok(job._runtimeTimeout, 'a processing render arms its runtime budget');

    const eventsBefore = jobEvents.length;
    retry(client, project, 'IMG-FIRST');

    // Deliberately not surfaced as a job event: as a job error it would fail
    // this single-media project, the exact render the retry exists to save.
    assert.equal(jobEvents.length, eventsBefore, 'jobRetry must not emit a job event');
    assert.equal(job.status, 'pending');
    assert.equal(job.workerName, undefined);
    assert.notEqual(project.status, 'failed');
    assert.equal(project.finished, false);
    assert.equal(job._runtimeTimeout, null, 'the departed worker’s runtime budget must stop');
  }

  // THE BUG: the abandoned attempt's runtime budget must not cancel the project
  // on the server while the retry waits out a backlog.
  {
    const { client, project } = setup();
    const realSetTimeout = global.setTimeout;
    const scheduled = [];
    global.setTimeout = (fn, ms) => {
      const handle = realSetTimeout(() => {}, 0);
      scheduled.push({ fn, ms, handle });
      return handle;
    };
    try {
      started(client, project, 'IMG-FIRST');
      const budget = scheduled.find(({ ms }) => ms >= 60 * 60 * 1000);
      assert.ok(budget, 'a Fast video render arms an hour-plus runtime budget');

      retry(client, project, 'IMG-FIRST');
      // Even if that timer had not been cleared, firing it now must do nothing.
      budget.fn();
    } finally {
      global.setTimeout = realSetTimeout;
    }
    assert.equal(cancelsSent(client).length, 0, 'the stale budget must not cancel the project on the server');
    assert.notEqual(project.status, 'failed');
  }

  // Same bug on the SILENT path that has shipped for months (a disconnect
  // reclaim): no jobRetry, just the next worker's frame. Reproduced against
  // 5.45.0 as jobs=2, project failed, and one artistCanceled sent to the server.
  // The stale budget is fired directly, bypassing clearTimeout, so the job's own
  // guard is what has to hold: the reclaimed job is `processing` again, so
  // status alone cannot tell the dead attempt's budget from the live one.
  {
    const { client, project } = setup();
    const realSetTimeout = global.setTimeout;
    const scheduled = [];
    global.setTimeout = (fn, ms) => {
      const handle = realSetTimeout(() => {}, 0);
      scheduled.push({ fn, ms });
      return handle;
    };
    try {
      started(client, project, 'IMG-FIRST');
      const staleBudget = scheduled.find(({ ms }) => ms >= 60 * 60 * 1000);
      started(client, project, 'IMG-SECOND');
      staleBudget.fn();
    } finally {
      global.setTimeout = realSetTimeout;
    }
    assert.equal(project.jobs.length, 1);
    assert.equal(project.jobs[0].status, 'processing', 'the live retry keeps rendering');
    assert.equal(cancelsSent(client).length, 0, 'a stale budget must never cancel the project on the server');
    assert.notEqual(project.status, 'failed');
  }

  // The retry reclaims the SAME job under its new id, from a clean start.
  {
    const { client, project } = setup();
    started(client, project, 'IMG-FIRST');
    progress(client, project, 'IMG-FIRST', 15);
    assert.equal(project.jobs[0].step, 15);
    const original = project.jobs[0];

    retry(client, project, 'IMG-FIRST');
    started(client, project, 'IMG-SECOND');

    assert.equal(project.jobs.length, 1, 'the retry must not add a second job');
    assert.equal(project.jobs[0], original, 'the retry reuses the same Job instance');
    assert.equal(project.jobs[0].id, 'IMG-SECOND');
    assert.equal(project.job('IMG-FIRST'), undefined);
    assert.equal(project.jobs[0].status, 'processing');
    assert.equal(project.jobs[0].workerName, 'worker-IMG-SECOND');

    // step only moves forward, so without the reset the new attempt would be
    // pinned at the old attempt's high-water mark.
    progress(client, project, 'IMG-SECOND', 2);
    assert.equal(project.jobs[0].step, 2, 'the new attempt must not inherit the old high-water mark');
    assert.ok(project.jobs[0]._runtimeTimeout, 'the retry arms its own fresh budget');
  }

  // Silent reassignment (disconnect reclaim / personal-LoRA requeue): no
  // jobRetry at all, only the next worker's frame with the same jobIndex.
  {
    const { client, project } = setup();
    started(client, project, 'IMG-FIRST');
    const original = project.jobs[0];

    started(client, project, 'IMG-SECOND');

    assert.equal(project.jobs.length, 1, 'a silent reassignment must not add a second job');
    assert.equal(project.jobs[0], original);
    assert.equal(project.jobs[0].id, 'IMG-SECOND');
  }

  // Silent paths never send jobRetry, so the queue-wait window is closed by the
  // project going back to queued: nothing is on a worker any more.
  {
    const { client, project } = setup();
    started(client, project, 'IMG-FIRST');
    assert.ok(project.jobs[0]._runtimeTimeout);

    client.socket.emit('jobState', { type: 'queued', jobID: project.id, queuePosition: 4 });

    assert.equal(project.jobs[0]._runtimeTimeout, null, 'a re-queued project must not keep a render budget running');
    assert.equal(project.status, 'queued');
  }

  // A batch: each reassigned render reclaims its OWN job by jobIndex, in any
  // order, and the siblings are never touched.
  {
    const { client, project } = setup({ numberOfMedia: 3 });
    started(client, project, 'IMG-A', 0);
    started(client, project, 'IMG-B', 1);
    started(client, project, 'IMG-C', 2);
    const [jobA, jobB, jobC] = project.jobs;

    retry(client, project, 'IMG-A', 0);
    retry(client, project, 'IMG-C', 2);
    assert.equal(jobB.status, 'processing', 'a sibling that never failed is untouched');

    started(client, project, 'IMG-C2', 2);
    started(client, project, 'IMG-A2', 0);

    assert.equal(project.jobs.length, 3);
    assert.equal(jobA.id, 'IMG-A2');
    assert.equal(jobB.id, 'IMG-B');
    assert.equal(jobC.id, 'IMG-C2');
  }

  // A genuinely new render in a batch is not mistaken for a reassignment.
  {
    const { client, project } = setup({ numberOfMedia: 2 });
    started(client, project, 'IMG-A', 0);
    started(client, project, 'IMG-B', 1);
    assert.equal(project.jobs.length, 2, 'a first attempt at another index is a new job');
    assert.deepEqual(
      project.jobs.map((job) => job.id),
      ['IMG-A', 'IMG-B']
    );
  }

  // With no jobIndex, only a render explicitly announced as waiting is taken,
  // and only when it is the only one.
  {
    const { client, project } = setup({ numberOfMedia: 2 });
    client.socket.emit('jobState', { type: 'jobStarted', jobID: project.id, imgID: 'IMG-A', workerName: 'w' });
    client.socket.emit('jobState', { type: 'jobStarted', jobID: project.id, imgID: 'IMG-B', workerName: 'w' });
    assert.equal(project.jobs.length, 2);

    // Nothing announced: an unindexed new id is a new job, never a sibling.
    client.socket.emit('jobState', { type: 'jobStarted', jobID: project.id, imgID: 'IMG-NEW', workerName: 'w' });
    assert.equal(project.jobs.length, 3);
    assert.equal(project.job('IMG-A').status, 'processing');
  }

  // A real failure still fails -- the reassignment path must not mask one.
  {
    const { client, project } = setup();
    started(client, project, 'IMG-FIRST');
    retry(client, project, 'IMG-FIRST');
    started(client, project, 'IMG-SECOND');
    client.socket.emit('jobError', {
      jobID: project.id,
      imgID: 'IMG-SECOND',
      isFromWorker: true,
      error: 'genfailure',
      error_message: 'Generation failed'
    });
    assert.equal(project.jobs.length, 1);
    assert.equal(project.jobs[0].status, 'failed');
    assert.equal(project.status, 'failed');
  }

  // A retry followed by a normal completion finishes with one job.
  {
    const { client, project } = setup();
    started(client, project, 'IMG-FIRST');
    retry(client, project, 'IMG-FIRST');
    started(client, project, 'IMG-SECOND');
    client.socket.emit('jobState', { type: 'jobCompleted', jobID: project.id });
    assert.equal(project.jobs.length, 1);
    assert.equal(project.status, 'completed');
  }

  // Frames for an untracked or finished project are ignored without throwing.
  {
    const { client, project } = setup();
    client.socket.emit('jobRetry', { jobID: 'UNKNOWN', imgID: 'X', attempt: 1, maxAttempts: 1, isFromWorker: true, error: 'genfailure', error_message: '' });
    project._update({ status: 'completed' });
    retry(client, project, 'IMG-GONE');
  }

  console.log('check-job-reassignment: ALL TESTS PASSED');
  // Each started job arms a runtime budget measured in minutes, which would
  // otherwise hold the event loop open long after the assertions are done.
  process.exit(0);
}

main();
