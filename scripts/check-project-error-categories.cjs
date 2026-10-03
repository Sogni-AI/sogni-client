'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const ProjectsApi = require('../dist/Projects/index.js').default;
const Project = require('../dist/Projects/Project.js').default;

const client = new EventEmitter();
client.socket = new EventEmitter();
client.logger = { error() {}, warn() {}, info() {}, debug() {} };
const api = new ProjectsApi({ client, eip712: {} });
const projectEvents = [];
const jobEvents = [];
api.on('project', event => projectEvents.push(event));
api.on('job', event => jobEvents.push(event));

for (const category of ['content_policy', 'input_validation', 'timeout', 'result_storage', 'cancelled', 'vendor_failed', undefined]) {
  for (const imgID of ['render', undefined]) {
    const wire = { jobID: 'untracked-project', imgID, isFromWorker: false, error: '5061', error_message: 'Service message changed',
      ...(category ? { vendorFailureCategory: category } : {}),
      vendorFailureReason: 'Private detail', vendorResponse: { internal: true } };
    client.socket.emit('jobError', wire);
    const result = imgID ? jobEvents.at(-1) : projectEvents.at(-1);
    assert.deepEqual(result.error, { code: 5061, message: wire.error_message,
      ...(category ? { vendorFailureCategory: category } : {}) });
  }
}

// The category survives the real socket listener and the tracked Job update.
const project = new Project({ type: 'image', numberOfMedia: 2, steps: 4 }, { api, logger: client.logger });
api.projects.push(project);
client.socket.emit('jobError', { jobID: project.id, imgID: 'failed-render', isFromWorker: false,
  error: '5061', error_message: 'Service declined this generation', vendorFailureCategory: 'content_policy' });
assert.equal(project.job('failed-render').error.vendorFailureCategory, 'content_policy');
assert.equal(project.job('failed-render').status, 'failed');

// Existing cancellation codes and upgrade details remain intact.
client.socket.emit('jobError', { jobID: 'cancelled-project', isFromWorker: false,
  error: 'artistCanceled', error_message: 'artistCanceled' });
assert.equal(projectEvents.at(-1).error.originalCode, 'artistCanceled');
assert.equal(projectEvents.at(-1).error.vendorFailureCategory, undefined);
client.socket.emit('jobError', { jobID: 'upgrade-project', isFromWorker: false,
  error: 4081, error_message: 'Upgrade required', subscriptionLimit: true,
  requiredPlans: ['unlimited_pro'], feature: 'video_4k_render', limitation: 'Upgrade required' });
assert.deepEqual(projectEvents.at(-1).error, { code: 4081, message: 'Upgrade required', subscriptionLimit: true,
  requiredPlans: ['unlimited_pro'], feature: 'video_4k_render', limitation: 'Upgrade required' });

clearInterval(project._timeout);
project._timeout = null;
console.log('Project error category transport checks passed');
