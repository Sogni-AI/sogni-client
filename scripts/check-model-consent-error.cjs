'use strict';

// Model consent refusals (socket error 4103): a model whose tier requires a
// one-time agreement refuses every job until the account accepts it in a
// Sogni app. The SDK surfaces the refusal as a typed error that keeps the
// agreement reference, and never accepts the agreement itself.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pkgRoot = require('../dist/index.js');
const ProjectsApi = require('../dist/Projects/index.js').default;
const { MODEL_CONSENT_REQUIRED_ERROR_CODE, isModelConsentRequiredError } = pkgRoot;

class StubListeners {
  constructor() {
    this._listeners = new Map();
  }

  on(event, handler) {
    const list = this._listeners.get(event) ?? [];
    list.push(handler);
    this._listeners.set(event, list);
  }

  off(event, handler) {
    const list = this._listeners.get(event) ?? [];
    this._listeners.set(
      event,
      list.filter((h) => h !== handler)
    );
  }

  emit(event, data) {
    for (const handler of this._listeners.get(event) ?? []) {
      handler(data);
    }
  }
}

class StubSocket extends StubListeners {
  get isConnected() {
    return false;
  }

  get supernetType() {
    return 'fast';
  }

  async send() {}
}

function makeStubClient() {
  const auth = new StubListeners();
  auth.isAuthenticated = true;
  auth.authenticateRequest = async (init) => init ?? {};
  return {
    auth,
    socket: new StubSocket(),
    rest: { baseUrl: 'https://api.example.test', async get() {}, async post() {} },
    appId: 'model-consent-test',
    appSource: 'sdk-test',
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    on() {},
    off() {}
  };
}

const CONSENT_MESSAGE =
  'Seedance 2.5 Uncensored requires a one-time likeness and consent agreement. Review and accept it in the Sogni app, then try again.';
const CONSENT = { key: 'seedance-2-5-spicy', version: 1, modelId: 'seedance-2-5-spicy' };

// The constant and helper are package-root exports.
assert.equal(MODEL_CONSENT_REQUIRED_ERROR_CODE, 4103);
assert.equal(typeof isModelConsentRequiredError, 'function');
const declarations = fs.readFileSync(path.join(__dirname, '../dist/index.d.ts'), 'utf8');
assert.ok(declarations.includes('ModelConsentRequirement'), 'ModelConsentRequirement type export');

// Helper: the numeric and string wire codes, ErrorData, and the agreement object.
assert.equal(isModelConsentRequiredError(4103), true);
assert.equal(isModelConsentRequiredError('4103'), true);
assert.equal(isModelConsentRequiredError({ code: 4103, message: CONSENT_MESSAGE }), true);
assert.equal(isModelConsentRequiredError({ code: '4103' }), true);
assert.equal(isModelConsentRequiredError({ errorCode: '4103' }), true);
assert.equal(isModelConsentRequiredError({ code: 0, consentRequired: CONSENT }), true);
for (const other of [4102, '4081', 0, '', null, undefined, {}, { code: 4081 }]) {
  assert.equal(isModelConsentRequiredError(other), false, `${JSON.stringify(other)} is not 4103`);
}
assert.equal(isModelConsentRequiredError({ code: 1, consentRequired: null }), false);

// Render path: the socket jobError keeps the agreement on the ErrorData that
// project failures reject with, for project- and job-level errors alike.
{
  const client = makeStubClient();
  const projects = new ProjectsApi({ client, eip712: {} });
  const events = [];
  projects.on('project', (event) => events.push(event));
  projects.on('job', (event) => events.push(event));

  client.socket.emit('jobError', {
    jobID: 'proj_consent',
    isFromWorker: false,
    error: '4103',
    error_message: CONSENT_MESSAGE,
    consentRequired: CONSENT
  });
  client.socket.emit('jobError', {
    jobID: 'proj_consent_job',
    imgID: 'job_consent',
    isFromWorker: false,
    error: 4103,
    error_message: CONSENT_MESSAGE,
    consentRequired: CONSENT
  });

  const projectError = events.find((e) => e.type === 'error' && e.projectId === 'proj_consent');
  assert.ok(projectError, 'an imgID-less jobError must emit a project-level error');
  assert.deepEqual(projectError.error, {
    code: 4103,
    message: CONSENT_MESSAGE,
    consentRequired: CONSENT
  });
  assert.equal(isModelConsentRequiredError(projectError.error), true);

  const jobError = events.find((e) => e.type === 'error' && e.jobId === 'job_consent');
  assert.ok(jobError, 'a jobError with imgID must emit a job-level error');
  assert.deepEqual(jobError.error.consentRequired, CONSENT);
  assert.equal(isModelConsentRequiredError(jobError.error), true);

  // Other job errors gain no agreement field.
  client.socket.emit('jobError', {
    jobID: 'proj_other',
    isFromWorker: false,
    error: '4102',
    error_message: 'This prompt is too long for the model.'
  });
  const otherError = events.find((e) => e.type === 'error' && e.projectId === 'proj_other');
  assert.equal('consentRequired' in otherError.error, false);
  assert.equal(isModelConsentRequiredError(otherError.error), false);
}

console.log('Model consent (4103) error checks passed');
