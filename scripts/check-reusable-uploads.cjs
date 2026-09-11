'use strict';
const assert = require('node:assert/strict');
const ReusableUploads = require('../dist/Projects/ReusableUploads.js').default;
const { ApiError } = require('../dist/ApiClient/index.js');

async function main() {
  const originalFetch = global.fetch;
  let uploaded = 0;
  let ready = false;
  const bindings = [];
  const calls = [];
  const record = { id: 'asset-id', name: 'Saved upload', bytes: 5, contentType: 'image/png', state: 'ready', createdAt: 1, expiresAt: 2 };
  const rest = {
    async get(path) { return { data: path.endsWith('/capabilities') ? { enabled: true } : { assets: [record], limits: {} } }; },
    async delete(path) { calls.push(path); },
    async post(path, data) {
      calls.push(path);
      if (path.endsWith('/prepare')) {
        assert.match(data.sha256, /^[a-f0-9]{64}$/);
        return { data: { ...record, state: ready ? 'ready' : 'uploading', reused: ready,
          uploadUrl: 'https://uploads.example.test/file', uploadHeaders: { 'Content-Type': 'image/png', 'If-None-Match': '*' } } };
      }
      if (path.endsWith('/finalize')) { ready = true; return { data: record }; }
      if (path.endsWith('/bind')) { bindings.push(data); return { data: { contentType: 'image/png' } }; }
      throw new Error('Unexpected request');
    }
  };
  try {
    global.fetch = async (_url, init) => {
      uploaded += 1;
      assert.equal(init.credentials, 'omit');
      assert.equal(init.redirect, 'error');
      assert.equal(init.headers['If-None-Match'], '*');
      return { ok: true, status: 200 };
    };
    const assets = new ReusableUploads(rest);
    const file = new Blob(['image'], { type: 'image/png' });
    await Promise.all(['project-one', 'project-two'].map(projectId => assets.tryBindFile(file, 'image/png', { projectId, type: 'referenceImage' })));
    assert.equal(uploaded, 1);
    assert.equal(bindings.length, 2);
    assert.equal((await assets.list()).assets[0].id, record.id);
    await assets.remove(record.id);
    assert(calls.includes('/v1/assets/asset-id'));
    let checks = 0;
    const unavailable = new ReusableUploads({ get: async () => { checks++; return { data: { enabled: false } }; }, post: async () => { throw new ApiError(403, { status: 'error', errorCode: 0, message: 'Subscription required' }); } });
    assert.equal(await unavailable.tryBindFile(file, 'image/png', { projectId: 'legacy', type: 'referenceImage' }), false);
    assert.equal(await unavailable.tryBindFile(file, 'image/png', { projectId: 'legacy-two', type: 'referenceImage' }), false);
    assert.equal(checks, 1, 'capability checks are coalesced and cached before hashing');
    await assert.rejects(() => unavailable.upload(file, 'image/png'), /Subscription/);
    const wrongChecksum = new ReusableUploads({ get: rest.get, post: async (path) => path.endsWith('/prepare') ? { data: { ...record, state: 'uploading', uploadUrl: 'https://uploads.example.test/file', uploadHeaders: { 'If-None-Match': '*' } } } : Promise.reject(new ApiError(409, { status: 'error', errorCode: 0, message: 'Checksum mismatch' })) });
    await assert.rejects(() => wrongChecksum.tryBindFile(file, 'image/png', { projectId: 'never-queued', type: 'referenceImage' }), /Checksum/);
    const noQuota = new ReusableUploads({ get: rest.get, post: async () => { throw new ApiError(409, { status: 'error', errorCode: 0, message: 'Library full' }); } });
    assert.equal(await noQuota.tryBindFile(file, 'image/png', { projectId: 'legacy-three', type: 'referenceImage' }), false);
    const { EventEmitter } = require('node:events');
    const auth = new EventEmitter();
    const switched = new ReusableUploads({ ...rest, auth });
    const inFlight = switched.upload(file, 'image/png');
    auth.emit('updated', false);
    await assert.rejects(() => inFlight, /account changed/);
    const ProjectsApi = require('../dist/Projects/index.js').default;
    const client = Object.assign(new EventEmitter(), {
      rest, socket: Object.assign(new EventEmitter(), { send: async () => {} }),
      logger: { debug() {}, info() {}, warn() {}, error() {} }
    });
    const projects = new ProjectsApi({ client, eip712: {} });
    const uploadsBefore = uploaded;
    for (const method of ['uploadGuideImage', 'uploadCNImage', 'uploadReferenceImage', 'uploadReferenceMask', 'uploadReferenceImageEnd']) await projects[method]('project-inputs', file);
    await projects.uploadContextImage('project-inputs', 15, file);
    await projects.uploadReferenceVideo('project-inputs', new Blob(['video'], { type: 'video/mp4' }), 'referenceVideo2');
    await projects.uploadReferenceAudio('project-inputs', new Blob(['audio'], { type: 'audio/wav' }), 'referenceAudio3');
    assert.equal(uploaded, uploadsBefore, 'all project helpers bind cached files before falling back to direct uploads');
    assert.deepEqual(bindings.slice(-8).map(value => [value.type, value.id]), [
      ['startingImage', undefined], ['cnImage', undefined], ['referenceImage', undefined], ['referenceMask', undefined],
      ['referenceImageEnd', undefined], ['contextImage16', undefined], ['referenceVideo', 'referenceVideo2'], ['referenceAudio', 'referenceAudio3']
    ]);
    const sent = [];
    client.socket.send = async (type, data) => sent.push({ type, data });
    projects._assets = wrongChecksum;
    projects.getModelOptions = async () => ({ type: 'image', steps: { min: 1, max: 1, step: 1, default: 1 }, guidance: { min: 0, max: 1, step: 0.1, default: 0 }, sampler: { allowed: [], default: null }, scheduler: { allowed: [], default: null } });
    await assert.rejects(() => projects.create({ type: 'image', modelId: 'birefnet_image_background_removal_fp16', positivePrompt: '', numberOfMedia: 1, startingImage: file }), /Checksum/);
    assert.equal(sent.some(message => message.type === 'jobRequest'), false, 'verification failure must precede socket submission');
    process.stdout.write('Reusable upload checks passed: single upload, cross-project binding, owner-scoped management, fallback, and pre-submission errors.\n');
  } finally { global.fetch = originalFetch; }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
