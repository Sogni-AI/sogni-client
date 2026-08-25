/** Regression checks for server-confirmed project cancellation. */

'use strict';

const assert = require('node:assert/strict');

const ProjectsApi = require('../dist/Projects/index.js').default;

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

  console.log('check-project-cancellation: ALL TESTS PASSED');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
