'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const ts = require('typescript');

const program = ts.createProgram([path.join(__dirname, 'fixtures/project-error-categories.ts')], {
  strict: true,
  noEmit: true,
  skipLibCheck: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.Node16,
  moduleResolution: ts.ModuleResolutionKind.Node16
});
const diagnostics = ts.getPreEmitDiagnostics(program);
assert.equal(
  diagnostics.length,
  0,
  ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCurrentDirectory: () => process.cwd(),
    getCanonicalFileName: (name) => name,
    getNewLine: () => '\n'
  })
);

function checkTransport(ProjectsApi, Project) {
  const client = new EventEmitter();
  client.socket = new EventEmitter();
  client.logger = { error() {}, warn() {}, info() {}, debug() {} };
  const api = new ProjectsApi({ client, eip712: {} });
  const projectEvents = [];
  const jobEvents = [];
  api.on('project', (event) => projectEvents.push(event));
  api.on('job', (event) => jobEvents.push(event));

  const categories = [
    'content_policy',
    'input_validation',
    'timeout',
    'result_storage',
    'cancelled',
    'vendor_failed',
    'asset_resolution',
    'vendor_transient',
    'future_category',
    undefined
  ];
  for (const category of categories) {
    for (const imgID of ['render', undefined]) {
      const wire = {
        jobID: 'untracked-project',
        imgID,
        isFromWorker: false,
        error: '5061',
        error_message: 'Service message changed',
        ...(category ? { vendorFailureCategory: category } : {}),
        vendorFailureReason: 'Private detail',
        vendorResponse: { internal: true }
      };
      client.socket.emit('jobError', wire);
      const result = imgID ? jobEvents.at(-1) : projectEvents.at(-1);
      assert.deepEqual(result.error, {
        code: 5061,
        message: wire.error_message,
        ...(category ? { vendorFailureCategory: category } : {})
      });
    }
  }

  // Categories also survive tracked Job and Project state updates.
  for (const category of categories) {
    for (const imgID of ['failed-render', undefined]) {
      const project = new Project(
        { type: 'image', numberOfMedia: 2, steps: 4 },
        { api, logger: client.logger }
      );
      api.projects.push(project);
      client.socket.emit('jobError', {
        jobID: project.id,
        imgID,
        isFromWorker: false,
        error: '5061',
        error_message: 'Service declined this generation',
        ...(category ? { vendorFailureCategory: category } : {})
      });
      const target = imgID ? project.job(imgID) : project;
      assert.equal(target.error.vendorFailureCategory, category);
      assert.equal(target.status, 'failed');
      clearInterval(project._timeout);
      project._timeout = null;
    }
  }

  // Existing cancellation codes and upgrade details remain intact.
  client.socket.emit('jobError', {
    jobID: 'cancelled-project',
    isFromWorker: false,
    error: 'artistCanceled',
    error_message: 'artistCanceled'
  });
  assert.equal(projectEvents.at(-1).error.originalCode, 'artistCanceled');
  assert.equal(projectEvents.at(-1).error.vendorFailureCategory, undefined);
  client.socket.emit('jobError', {
    jobID: 'upgrade-project',
    isFromWorker: false,
    error: 4081,
    error_message: 'Upgrade required',
    subscriptionLimit: true,
    requiredPlans: ['unlimited_pro'],
    feature: 'video_4k_render',
    limitation: 'Upgrade required'
  });
  assert.deepEqual(projectEvents.at(-1).error, {
    code: 4081,
    message: 'Upgrade required',
    subscriptionLimit: true,
    requiredPlans: ['unlimited_pro'],
    feature: 'video_4k_render',
    limitation: 'Upgrade required'
  });
}

async function main() {
  checkTransport(
    require('../dist/Projects/index.js').default,
    require('../dist/Projects/Project.js').default
  );
  const [esmApi, esmProject] = await Promise.all([
    import('../dist-esm/Projects/index.js'),
    import('../dist-esm/Projects/Project.js')
  ]);
  checkTransport(esmApi.default, esmProject.default);
  console.log('Project error category public type and CJS/ESM transport checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
