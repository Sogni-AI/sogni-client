/**
 * Regression checks for queue inactivity and actual worker-job runtime limits.
 * Runs against compiled `dist/` output.
 */

'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const Project = require('../dist/Projects/Project.js').default;
const ChatToolsApi = require('../dist/Chat/ChatTools.js').default;

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const THIRTY_MINUTES = 30 * MINUTE;
const NINETY_MINUTES = 90 * MINUTE;
const TWO_HOURS = 2 * HOUR;
const EIGHT_HOURS = 8 * HOUR;
const TWELVE_HOURS = 12 * HOUR;
const SILENT_LOGGER = { info() {}, warn() {}, error() {}, debug() {} };

class ApiStub {
  constructor(currentNetwork = 'fast') {
    this.timedOutProjectIds = [];
    this.currentNetwork = currentNetwork;
  }

  _currentNetwork() {
    return this.currentNetwork;
  }

  async _notifyProjectTimedOut(projectId) {
    this.timedOutProjectIds.push(projectId);
  }
}

function makeCoreProject(api, numberOfMedia = 1, params = {}) {
  const project = new Project(
    { type: 'image', modelId: 'test-model', numberOfMedia, positivePrompt: 'x', ...params },
    { api, logger: SILENT_LOGGER }
  );
  if (project._timeout) {
    clearInterval(project._timeout);
    project._timeout = null;
  }
  return project;
}

/**
 * Arm one job and report the runtime budget it scheduled, without letting the
 * timer actually fire.
 */
function armedRuntimeBudget({ params = {}, currentNetwork = 'fast', etaSeconds } = {}) {
  const realSetTimeout = global.setTimeout;
  const realClearTimeout = global.clearTimeout;
  const scheduled = [];
  global.setTimeout = (callback, delay) => {
    const handle = { callback, delay, cleared: false };
    scheduled.push(handle);
    return handle;
  };
  global.clearTimeout = (handle) => {
    handle.cleared = true;
  };
  try {
    const project = makeCoreProject(new ApiStub(currentNetwork), 1, params);
    const job = project._addJob({
      id: 'job-1',
      projectId: project.id,
      status: 'pending',
      step: 0,
      stepCount: 10
    });
    // The socket may deliver an ETA before the job starts; the budget is sized
    // once, when the job first goes to processing.
    if (typeof etaSeconds === 'number') job._update({ etaSeconds });
    job._update({ status: 'processing' });
    assert.equal(scheduled.length, 1, 'exactly one runtime limit must be armed');
    return scheduled[0].delay;
  } finally {
    global.setTimeout = realSetTimeout;
    global.clearTimeout = realClearTimeout;
  }
}

/**
 * The budget must sit above the real render-time distribution per network and
 * media type. A flat 30 minutes cancelled ~11% of runnable MiniMax H3
 * reference-video jobs mid-render; relaxed video runs undistilled for hours.
 */
async function checkRuntimeBudgetSizing() {
  assert.equal(
    armedRuntimeBudget({ params: { type: 'image' }, currentNetwork: 'fast' }),
    THIRTY_MINUTES,
    'fast image keeps the 30 minute budget'
  );
  assert.equal(
    armedRuntimeBudget({ params: { type: 'video' }, currentNetwork: 'fast' }),
    NINETY_MINUTES,
    'fast video gets 90 minutes'
  );
  assert.equal(
    armedRuntimeBudget({ params: { type: 'video' }, currentNetwork: 'relaxed' }),
    EIGHT_HOURS,
    'relaxed video gets 8 hours for undistilled renders'
  );
  assert.equal(
    armedRuntimeBudget({ params: { type: 'image' }, currentNetwork: 'relaxed' }),
    TWO_HOURS,
    'relaxed image gets 2 hours'
  );

  // An explicit per-project pin wins over the connection's current network.
  assert.equal(
    armedRuntimeBudget({ params: { type: 'video', network: 'relaxed' }, currentNetwork: 'fast' }),
    EIGHT_HOURS,
    'an explicit relaxed pin is honoured on a fast connection'
  );
  assert.equal(
    armedRuntimeBudget({ params: { type: 'video', network: 'fast' }, currentNetwork: 'relaxed' }),
    NINETY_MINUTES,
    'an explicit fast pin is honoured on a relaxed connection'
  );

  // Unknown network must fail open to the generous budget: over-waiting is
  // recoverable, a wrongly cancelled render is not.
  assert.equal(
    armedRuntimeBudget({ params: { type: 'video' }, currentNetwork: null }),
    EIGHT_HOURS,
    'unknown network budgets a video job as relaxed'
  );

  // The ETA term mirrors the worker's own overrun rule and only ever raises.
  assert.equal(
    armedRuntimeBudget({ params: { type: 'video' }, currentNetwork: 'fast', etaSeconds: 60 }),
    NINETY_MINUTES,
    'a short ETA never lowers the floor'
  );
  assert.equal(
    armedRuntimeBudget({ params: { type: 'video' }, currentNetwork: 'fast', etaSeconds: 3600 }),
    6 * 3600 * 1000,
    'a long ETA raises the budget to 6x the estimate'
  );
  assert.equal(
    armedRuntimeBudget({ params: { type: 'video' }, currentNetwork: 'relaxed', etaSeconds: 36000 }),
    TWELVE_HOURS,
    'the absolute ceiling still bounds a runaway ETA'
  );
}

async function checkActualJobRuntimeLimit() {
  const realSetTimeout = global.setTimeout;
  const realClearTimeout = global.clearTimeout;
  const scheduled = [];

  global.setTimeout = (callback, delay) => {
    const handle = { callback, delay, cleared: false };
    scheduled.push(handle);
    return handle;
  };
  global.clearTimeout = (handle) => {
    handle.cleared = true;
  };

  try {
    const api = new ApiStub();
    const project = makeCoreProject(api, 2);
    const firstJob = project._addJob({
      id: 'job-1',
      projectId: project.id,
      status: 'pending',
      step: 0,
      stepCount: 10
    });
    const secondJob = project._addJob({
      id: 'job-2',
      projectId: project.id,
      status: 'pending',
      step: 0,
      stepCount: 10
    });

    firstJob._update({ status: 'initiating' });
    assert.equal(scheduled.length, 0, 'worker assignment must not start the runtime limit');

    firstJob._update({ status: 'processing' });
    assert.equal(scheduled.length, 1, 'jobStart must arm one runtime limit');
    assert.equal(scheduled[0].delay, THIRTY_MINUTES, 'fast image budget');

    firstJob._update({ step: 1 });
    firstJob._update({ step: 2, externalProgress: 20 });
    assert.equal(scheduled.length, 1, 'progress must not reset the hard runtime limit');
    assert.equal(scheduled[0].cleared, false);

    scheduled[0].callback();
    await Promise.resolve();

    assert.equal(firstJob.status, 'failed');
    assert.equal(secondJob.status, 'failed', 'project cancellation must settle sibling jobs');
    assert.equal(project.status, 'failed');
    assert.deepEqual(api.timedOutProjectIds, [project.id]);
    // The message must name the budget that actually applied, not a constant.
    assert.match(project.error.message, /job-1.*30 minutes.*project canceled/i);
    assert.match(firstJob.error.message, /exceeded the maximum runtime of 30 minutes/i);
  } finally {
    global.setTimeout = realSetTimeout;
    global.clearTimeout = realClearTimeout;
  }
}

/** A relaxed video job that does blow its budget reports the real figure. */
async function checkVideoRuntimeTimeoutMessage() {
  const realSetTimeout = global.setTimeout;
  const realClearTimeout = global.clearTimeout;
  const scheduled = [];
  global.setTimeout = (callback, delay) => {
    const handle = { callback, delay, cleared: false };
    scheduled.push(handle);
    return handle;
  };
  global.clearTimeout = (handle) => {
    handle.cleared = true;
  };
  try {
    const api = new ApiStub('relaxed');
    const project = makeCoreProject(api, 1, { type: 'video' });
    const job = project._addJob({
      id: 'job-v1',
      projectId: project.id,
      status: 'pending',
      step: 0,
      stepCount: 20
    });
    job._update({ status: 'processing' });
    assert.equal(scheduled[0].delay, EIGHT_HOURS);

    scheduled[0].callback();
    await Promise.resolve();

    assert.equal(job.status, 'failed');
    assert.match(job.error.message, /exceeded the maximum runtime of 8 hours/i);
    assert.match(project.error.message, /job-v1.*8 hours.*project canceled/i);
    assert.deepEqual(api.timedOutProjectIds, [project.id]);
  } finally {
    global.setTimeout = realSetTimeout;
    global.clearTimeout = realClearTimeout;
  }
}

function makeToolProject() {
  const project = new EventEmitter();
  project.id = 'tool-project';
  project.status = 'queued';
  project.jobs = [];
  project.finished = false;
  project.cancelCount = 0;
  project.cancel = async () => {
    project.cancelCount++;
    project.finished = true;
  };
  project.waitForCompletion = () =>
    new Promise((resolve, reject) => {
      project.resolveCompletion = (urls) => {
        project.finished = true;
        resolve(urls);
      };
      project.rejectCompletion = reject;
    });
  return project;
}

async function settleMicrotasks() {
  for (let i = 0; i < 20; i++) {
    // Direct tool execution crosses validation, model selection, project
    // creation, and Promise.race setup before arming the queue timer.
    // eslint-disable-next-line no-await-in-loop
    await Promise.resolve();
  }
}

async function checkToolQueueTimeout() {
  const realSetTimeout = global.setTimeout;
  const realClearTimeout = global.clearTimeout;
  const scheduled = [];

  global.setTimeout = (callback, delay) => {
    const handle = { callback, delay, cleared: false };
    scheduled.push(handle);
    return handle;
  };
  global.clearTimeout = (handle) => {
    handle.cleared = true;
  };

  try {
    const project = makeToolProject();
    const projects = {
      waitForModels: async () => [{ id: 'flux1-schnell-fp8', media: 'image', workerCount: 1 }],
      create: async () => project
    };
    const api = new ChatToolsApi(projects);
    const toolCall = {
      id: 'call-1',
      type: 'function',
      function: {
        name: 'generate_image',
        arguments: JSON.stringify({ prompt: 'cat', model: 'flux1-schnell-fp8' })
      }
    };

    const resultPromise = api.execute(toolCall);
    await settleMicrotasks();

    assert.equal(scheduled.length, 1, 'queued tool project must arm its inactivity timeout');
    assert.equal(scheduled[0].delay, NINETY_MINUTES, 'default queue timeout must be 90 minutes');

    const job = new EventEmitter();
    job.status = 'pending';
    project.jobs.push(job);
    project.emit('jobStarted', job);
    job.status = 'initiating';
    job.emit('updated', ['status']);
    assert.equal(scheduled.length, 1, 'assignment must not reset the queue timeout');
    assert.equal(scheduled[0].cleared, false);

    job.status = 'processing';
    job.emit('updated', ['status']);
    assert.equal(scheduled[0].cleared, true, 'active job must pause the queue timeout');

    // Completing one job in a larger project starts a fresh queue window for
    // the next job instead of applying a total project wall-clock limit.
    job.status = 'completed';
    job.emit('updated', ['status']);
    assert.equal(scheduled.length, 2);
    assert.equal(scheduled[1].delay, NINETY_MINUTES);

    project.resolveCompletion(['https://cdn.sogni.ai/result.png']);
    const result = await resultPromise;
    assert.equal(result.success, true);
    assert.equal(project.cancelCount, 0);
    assert.equal(scheduled[1].cleared, true);
  } finally {
    global.setTimeout = realSetTimeout;
    global.clearTimeout = realClearTimeout;
  }
}

Promise.resolve()
  .then(checkActualJobRuntimeLimit)
  .then(checkRuntimeBudgetSizing)
  .then(checkVideoRuntimeTimeoutMessage)
  .then(checkToolQueueTimeout)
  .then(() => console.log('check-project-timeouts: ALL TESTS PASSED'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
