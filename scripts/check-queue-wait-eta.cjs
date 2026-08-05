/**
 * Regression checks for the public queued-project wait contract.
 * Runs against compiled `dist/` output.
 */

'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const Project = require('../dist/Projects/Project.js').default;
const ProjectsApi = require('../dist/Projects/index.js').default;

const SILENT_LOGGER = { info() {}, warn() {}, error() {}, debug() {} };

class SocketStub extends EventEmitter {}

class ClientStub extends EventEmitter {
  constructor() {
    super();
    this.socket = new SocketStub();
    this.logger = SILENT_LOGGER;
  }
}

function makeTrackedProject(api) {
  const project = new Project(
    { type: 'image', modelId: 'test-model', numberOfMedia: 1, positivePrompt: 'x' },
    { api, logger: SILENT_LOGGER }
  );
  if (project._timeout) {
    clearInterval(project._timeout);
    project._timeout = null;
  }
  api.projects.push(project);
  return project;
}

function main() {
  const client = new ClientStub();
  const api = new ProjectsApi({ client, eip712: {} });
  const project = makeTrackedProject(api);
  const queuedEvents = [];
  api.on('project', (event) => {
    if (event.type === 'queued') queuedEvents.push(event);
  });

  const realDateNow = Date.now;
  Date.now = () => 1_700_000_000_000;

  try {
    client.socket.emit('jobState', {
      type: 'queued',
      jobID: project.id,
      queuePosition: 2,
      estimatedStartSeconds: 90,
      queueStatus: 'waiting'
    });

    assert.deepEqual(queuedEvents.at(-1), {
      type: 'queued',
      projectId: project.id,
      queuePosition: 2,
      estimatedStartSeconds: 90,
      queueStatus: 'waiting'
    });
    assert.equal(project.estimatedStartAt.getTime(), Date.now() + 90_000);
    assert.equal(project.queueStatus, 'waiting');

    client.socket.emit('jobState', {
      type: 'queued',
      jobID: project.id,
      queuePosition: 1,
      estimatedStartSeconds: null,
      queueStatus: 'no-workers'
    });

    assert.equal(project.estimatedStartAt, undefined);
    assert.equal(project.queueStatus, 'no-workers');

    client.socket.emit('jobState', {
      type: 'queued',
      jobID: project.id,
      queuePosition: 1,
      estimatedStartSeconds: 30,
      queueStatus: 'waiting'
    });
    client.socket.emit('jobState', {
      type: 'queued',
      jobID: project.id,
      queuePosition: 1
    });

    assert.equal(project.estimatedStartAt, undefined, 'an omitted estimate must clear stale data');
    assert.equal(project.queueStatus, undefined, 'an omitted status must clear stale data');

    client.socket.emit('jobState', {
      type: 'queued',
      jobID: project.id,
      queuePosition: 1,
      estimatedStartSeconds: -1,
      queueStatus: 'internal-only'
    });

    assert.equal(
      'estimatedStartSeconds' in queuedEvents.at(-1),
      false,
      'invalid estimates must not reach consumers'
    );
    assert.equal(
      'queueStatus' in queuedEvents.at(-1),
      false,
      'unknown statuses must not reach consumers'
    );

    client.socket.emit('jobState', {
      type: 'queued',
      jobID: project.id,
      queuePosition: 1,
      estimatedStartSeconds: 60,
      queueStatus: 'waiting'
    });
    client.socket.emit('jobState', {
      type: 'initiatingModel',
      jobID: project.id,
      imgID: 'job-1',
      workerName: 'worker',
      positivePrompt: 'x',
      negativePrompt: '',
      jobIndex: 0
    });

    assert.equal(project.estimatedStartAt, undefined, 'worker assignment ends the queue wait');
    assert.equal(project.queueStatus, undefined, 'worker assignment clears the queue state');
  } finally {
    Date.now = realDateNow;
  }

  console.log('check-queue-wait-eta: ALL TESTS PASSED');
}

main();
