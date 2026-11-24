'use strict';
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
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
    // The API keeps the saved file locked while copying it into a project.
    // A second submission must share preparation and wait for that copy,
    // rather than exhaust the ordinary 423 retry window against our own bind.
    let locked = false;
    let prepares = 0;
    let collisions = 0;
    let firstHash;
    let copyReleased = false;
    let releaseCopy;
    let firstCopyStarted;
    const copyGate = new Promise(resolve => { releaseCopy = resolve; });
    const started = new Promise(resolve => { firstCopyStarted = resolve; });
    const concurrent = new ReusableUploads({
      get: rest.get,
      async post(path, data) {
        const sameFile = path.endsWith('/prepare') ? !firstHash || data.sha256 === firstHash : path.includes('/asset-id/');
        if (locked && sameFile) {
          collisions++;
          throw new ApiError(423, { status: 'error', errorCode: 163, message: 'This upload is busy. Try again shortly.' });
        }
        if (path.endsWith('/prepare')) {
          if (!firstHash) firstHash = data.sha256;
          if (sameFile) prepares++;
          return { data: sameFile ? record : { ...record, id: 'other-asset' } };
        }
        if (path.endsWith('/bind')) {
          if (!sameFile) return { data: {} };
          locked = true;
          firstCopyStarted();
          await copyGate;
          locked = false;
          return { data: {} };
        }
        throw new Error('Unexpected saved-upload request');
      }
    });
    const firstBinding = concurrent.tryBindFile(file, 'image/png', { projectId: 'slow-copy-one', type: 'referenceImage' });
    await started;
    assert.equal((await concurrent.upload(file, 'image/png')).id, record.id, 'an explicit upload can use the prepared file without waiting for a project copy');
    const secondBinding = concurrent.tryBindFile(file, 'image/png', { projectId: 'slow-copy-two', type: 'referenceImage' });
    const releaseTimer = setTimeout(() => { copyReleased = true; releaseCopy(); }, 4200);
    const results = Promise.allSettled([firstBinding, secondBinding]);
    await concurrent.tryBindFile(new Blob(['other-image'], { type: 'image/png' }), 'image/png', { projectId: 'independent-copy', type: 'referenceImage' });
    assert.equal(copyReleased, false, 'a waiting same-file binding does not occupy both upload lanes');
    const concurrentResults = await results;
    clearTimeout(releaseTimer);
    assert.deepEqual(concurrentResults.map(result => result.status), ['fulfilled', 'fulfilled'], 'same-file submissions survive a copy longer than the 423 retry window');
    assert.equal(prepares, 1, 'preparation remains coalesced until the outstanding bindings finish');
    assert.equal(collisions, 0, 'the SDK never sends a second same-file request into its own active copy');
    let directCalls = 0;
    const direct = new ReusableUploads({
      async post() {
        if (++directCalls === 1) throw new ApiError(404, { status: 'error', errorCode: 0, message: 'Saved upload unavailable' });
        return { data: {} };
      }
    });
    const directResults = await Promise.allSettled([
      direct.bind('shared-file', { projectId: 'failed-copy', type: 'referenceImage' }),
      direct.bind('shared-file', { projectId: 'next-copy', type: 'referenceImage' })
    ]);
    assert.deepEqual(directResults.map(result => result.status), ['rejected', 'fulfilled'], 'a failed copy does not poison a later independent binding');
    assert.equal(directCalls, 2);

    const queuedAuth = new EventEmitter();
    let finishOldCopy;
    let announceOldCopy;
    let oldCopyCalls = 0;
    const oldCopyStarted = new Promise(resolve => { announceOldCopy = resolve; });
    const oldCopyGate = new Promise(resolve => { finishOldCopy = resolve; });
    const queuedAccount = new ReusableUploads({ auth: queuedAuth, async post() {
      oldCopyCalls++;
      announceOldCopy();
      await oldCopyGate;
      return { data: {} };
    } });
    const oldCopies = Promise.allSettled([
      queuedAccount.bind('account-file', { projectId: 'old-copy-one', type: 'referenceImage' }),
      queuedAccount.bind('account-file', { projectId: 'old-copy-two', type: 'referenceImage' })
    ]);
    await oldCopyStarted;
    queuedAuth.emit('updated', false);
    finishOldCopy();
    const switchedCopies = await oldCopies;
    assert(switchedCopies.every(result => result.status === 'rejected' && /account changed/.test(result.reason.message)), 'queued copies retain their originating account session');
    assert.equal(oldCopyCalls, 1, 'an account change prevents a queued copy from sending its request');
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
    let quotaPrepares = 0;
    const quotaAuth = new EventEmitter();
    const noQuota = new ReusableUploads({
      auth: quotaAuth,
      get: rest.get,
      delete: rest.delete,
      post: async () => {
        quotaPrepares += 1;
        throw new ApiError(409, { status: 'error', errorCode: 0, message: 'Your saved upload library is full. Remove an upload and try again.' });
      }
    });
    assert.equal(await noQuota.tryBindFile(file, 'image/png', { projectId: 'legacy-three', type: 'referenceImage' }), false);
    assert.equal(await noQuota.tryBindFile(file, 'image/png', { projectId: 'legacy-four', type: 'referenceImage' }), false);
    assert.equal(quotaPrepares, 1, 'a quota response suppresses repeated automatic prepare probes');
    quotaAuth.emit('updated', false);
    assert.equal(await noQuota.tryBindFile(file, 'image/png', { projectId: 'legacy-five', type: 'referenceImage' }), false);
    assert.equal(quotaPrepares, 2, 'an account change clears the quota suppression');
    await noQuota.remove(record.id);
    assert.equal(await noQuota.tryBindFile(file, 'image/png', { projectId: 'legacy-six', type: 'referenceImage' }), false);
    assert.equal(quotaPrepares, 3, 'an explicit removal clears the quota suppression');
    let concurrentQuotaPrepares = 0;
    const concurrentQuota = new ReusableUploads({
      get: rest.get,
      post: async () => {
        concurrentQuotaPrepares += 1;
        await new Promise(resolve => setTimeout(resolve, 10));
        throw new ApiError(409, { status: 'error', errorCode: 0, message: 'Your saved upload library is full. Remove an upload and try again.' });
      }
    });
    await Promise.all(Array.from({ length: 8 }, (_, index) =>
      concurrentQuota.tryBindFile(new Blob([`image-${index}`], { type: 'image/png' }), 'image/png', { projectId: `concurrent-${index}`, type: 'referenceImage' })
    ));
    assert.equal(concurrentQuotaPrepares, 2, 'only the two active lanes probe before queued automatic saves observe the quota block');
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
