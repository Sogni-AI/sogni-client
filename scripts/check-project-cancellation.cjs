/** Regression checks for server-confirmed project cancellation. */

'use strict';

const assert = require('node:assert/strict');

const ProjectsApi = require('../dist/Projects/index.js').default;
const Project = require('../dist/Projects/Project.js').default;
const ProjectCancellationRefusedError =
  require('../dist/Projects/ProjectCancellationRefusedError.js').default;

class EventTargetStub {
  constructor() {
    this.listeners = new Map();
    this.sent = [];
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

  async send(type, data) {
    this.sent.push({ type, data });
  }

  listenerCount(event) {
    return (this.listeners.get(event) ?? []).length;
  }
}

function makeProjectsApi() {
  const socket = new EventTargetStub();
  const client = {
    socket,
    on() {
      return () => {};
    },
    logger: { error() {} }
  };
  return {
    api: new ProjectsApi({ client, eip712: {} }),
    socket
  };
}

async function main() {
  for (const status of ['cancelled', 'errored']) {
    const reason = status === 'cancelled' ? 'artistCanceled' : 'Generation failed';
    const project = new Project(
      { type: 'image', numberOfMedia: 1, steps: 4 },
      {
        id: 'rest-terminal',
        logger: { warn() {}, error() {} },
        api: {
          get: async () => ({
            status,
            reason,
            imageCount: 1,
            stepCount: 4,
            completedWorkerJobs: []
          })
        }
      }
    );
    const waiting = project.waitForCompletion();
    const rejected = assert.rejects(waiting, (error) => error.message === reason);
    await project._syncToServer();
    await rejected;
    assert.equal(project.finished, true);
    assert.equal(project._timeout, null);
    await assert.rejects(project.waitForCompletion(), (error) => error.message === reason);
    assert.equal(project.listeners.completed.length, 0);
    assert.equal(project.listeners.failed.length, 0);
    assert.equal(project.listeners.updated.length, 1, 'only the project runtime listener remains');
  }

  {
    const project = new Project(
      { type: 'image', numberOfMedia: 1, steps: 4 },
      {
        id: 'live-cancellation',
        api: {},
        logger: { error() {} }
      }
    );
    const waiting = assert.rejects(
      project.waitForCompletion(),
      (error) => error.message === 'Project canceled'
    );
    project._update({ status: 'canceled' });
    await waiting;
  }

  {
    const { api, socket } = makeProjectsApi();
    let settled = false;
    const cancellation = api.cancel('confirmed-project').then(() => {
      settled = true;
    });

    await Promise.resolve();
    assert.equal(settled, false, 'cancel must wait for the server confirmation');
    assert.deepEqual(socket.sent, [
      {
        type: 'jobError',
        data: {
          jobID: 'confirmed-project',
          error: 'artistCanceled',
          error_message: 'artistCanceled',
          isFromWorker: false
        }
      }
    ]);

    socket.emit('artistCancelConfirmation', {
      didCancel: true,
      error_message: '',
      jobID: 'another-project'
    });
    await Promise.resolve();
    assert.equal(settled, false, 'a confirmation for another project must be ignored');

    socket.emit('artistCancelConfirmation', {
      didCancel: true,
      error_message: '',
      jobID: 'confirmed-project'
    });
    await cancellation;
    assert.equal(settled, true);
    assert.equal(socket.listenerCount('artistCancelConfirmation'), 0);
  }

  {
    const { api, socket } = makeProjectsApi();
    const cancellation = api.cancel('running-project');
    await Promise.resolve();
    socket.emit('artistCancelConfirmation', {
      didCancel: false,
      error_message: 'This vendor job has already started and can no longer be cancelled.',
      jobID: 'running-project'
    });

    await assert.rejects(
      cancellation,
      /already started and can no longer be cancelled/,
      'provider refusal must reject instead of reporting local cancellation'
    );
    assert.equal(socket.listenerCount('artistCancelConfirmation'), 0);
  }

  {
    const { api, socket } = makeProjectsApi();
    const cancellation = api.cancel('vendor-refused-project');
    await Promise.resolve();
    socket.emit('artistCancelConfirmation', {
      didCancel: false,
      error_message:
        "Generation has already started and can't be stopped. Your results will finish and be charged like any completed render.",
      jobID: 'vendor-refused-project',
      code: 'vendorCannotCancel',
      finishingImgIDs: ['IMG-RUNNING']
    });

    await assert.rejects(
      cancellation,
      (error) =>
        error instanceof ProjectCancellationRefusedError &&
        error instanceof Error &&
        error.code === 'vendorCannotCancel' &&
        error.finishingJobIds.join() === 'IMG-RUNNING' &&
        /already started/.test(error.message),
      'a provider refusal names its code and the jobs that keep running'
    );
  }

  {
    const { api, socket } = makeProjectsApi();
    const logger = { error() {}, warn() {} };
    const project = new Project(
      { type: 'image', numberOfMedia: 3, steps: 4 },
      { id: 'partial-project', api: {}, logger }
    );
    const job = (id) =>
      project._addJob({
        id,
        projectId: 'partial-project',
        status: 'processing',
        step: 0,
        stepCount: 4
      });
    const finishing = job('IMG-RUNNING');
    const stopped = job('IMG-STOPPED');
    api.projects.push(project);

    const cancellation = api.cancel('partial-project');
    await Promise.resolve();
    socket.emit('artistCancelConfirmation', {
      didCancel: true,
      jobID: 'partial-project',
      partial: true,
      code: 'vendorCannotCancel',
      finishingImgIDs: ['IMG-RUNNING'],
      message: "One was already being made and can't be stopped."
    });
    assert.deepEqual(await cancellation, {
      partial: true,
      finishingJobIds: ['IMG-RUNNING'],
      message: "One was already being made and can't be stopped."
    });
    assert.equal(stopped.status, 'canceled');
    assert.equal(
      finishing.status,
      'processing',
      'the job the provider could not stop keeps running'
    );
    assert.equal(project.finished, false);
    assert.ok(api.projects.includes(project), 'a partially cancelled project stays tracked');

    // The server's notice for a job it stopped is a cancellation, not a failure.
    const late = job('IMG-LATE');
    socket.emit('jobError', {
      jobID: 'partial-project',
      imgID: 'IMG-LATE',
      error: 'artistCanceled',
      error_message: 'Cancelled by artist request.',
      isFromWorker: false
    });
    assert.equal(late.status, 'canceled');
    assert.equal(project.finished, false);
    // Finish the fixture so its staleness and runtime timers stop.
    finishing._update({ status: 'completed' });
    project._update({ status: 'completed' });
  }

  {
    const { api, socket } = makeProjectsApi();
    const first = api.cancel('duplicate-project');
    const second = api.cancel('duplicate-project');
    await Promise.resolve();

    assert.equal(socket.sent.length, 1, 'concurrent callers must share one cancellation frame');
    assert.equal(
      socket.listenerCount('artistCancelConfirmation'),
      1,
      'concurrent callers must share one confirmation listener'
    );

    socket.emit('artistCancelConfirmation', {
      didCancel: true,
      jobID: 'duplicate-project'
    });
    await Promise.all([first, second]);
    assert.equal(socket.listenerCount('artistCancelConfirmation'), 0);
  }

  console.log('check-project-cancellation: ALL TESTS PASSED');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
