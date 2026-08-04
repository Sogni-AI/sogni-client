/**
 * Regression checks for queue inactivity and actual worker-job runtime limits.
 * Runs against compiled `dist/` output.
 */

'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const Project = require('../dist/Projects/Project.js').default;
const ChatToolsApi = require('../dist/Chat/ChatTools.js').default;

const THIRTY_MINUTES = 30 * 60 * 1000;
const NINETY_MINUTES = 90 * 60 * 1000;
const SILENT_LOGGER = { info() {}, warn() {}, error() {}, debug() {} };

class ApiStub {
  constructor() {
    this.timedOutProjectIds = [];
  }

  async _notifyProjectTimedOut(projectId) {
    this.timedOutProjectIds.push(projectId);
  }
}

function makeCoreProject(api, numberOfMedia = 1) {
  const project = new Project(
    { type: 'image', modelId: 'test-model', numberOfMedia, positivePrompt: 'x' },
    { api, logger: SILENT_LOGGER }
  );
  if (project._timeout) {
    clearInterval(project._timeout);
    project._timeout = null;
  }
  return project;
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
    assert.equal(scheduled[0].delay, THIRTY_MINUTES);

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
    assert.match(project.error.message, /job-1.*30 minutes.*project canceled/i);
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
  .then(checkToolQueueTimeout)
  .then(() => console.log('check-project-timeouts: ALL TESTS PASSED'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
