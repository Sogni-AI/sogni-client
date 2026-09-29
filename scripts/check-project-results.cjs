/*
 * projects.getResult and projects.listRecent: an agent or app that was offline,
 * or stopped waiting, can still learn what happened to its projects and fetch
 * their media, including after the socket stopped holding them (one hour).
 *
 * Run: npm run test:project-results
 */
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const ProjectsApi = require('../dist/Projects/index.js').default;

const SILENT_LOGGER = { error() {}, warn() {}, info() {}, debug() {} };

function makeApi({ status = {}, history = [], mint } = {}) {
  const calls = [];
  const client = new EventEmitter();
  client.logger = SILENT_LOGGER;
  client.appId = 'app-under-test';
  client.socket = new EventEmitter();
  client.socket.get = async () => {
    throw Object.assign(new Error('Not Found'), { status: 404 });
  };
  client.rest = {
    async get(path, query) {
      calls.push({ path, query });
      const statusMatch = path.match(/^\/v2\/projects\/(.+)$/);
      if (statusMatch) {
        const project = status[decodeURIComponent(statusMatch[1])];
        if (!project) throw Object.assign(new Error('Not Found'), { status: 404 });
        return { status: 'success', data: { project } };
      }
      if (path === '/v1/image/downloadUrl' || path === '/v1/media/downloadUrl') {
        if (mint) return mint(path, query);
        return { status: 'success', data: { downloadUrl: `https://cdn.test${path}/${query.jobId}/${query.imageId || query.id}` } };
      }
      if (path === '/v1/jobs/list') return { status: 'success', data: { jobs: history, next: null } };
      throw Object.assign(new Error('Not Found'), { status: 404 });
    }
  };
  const api = new ProjectsApi({ client, eip712: {} });
  api._listActiveProjectIds = async () => null;
  return { api, calls };
}

const stop = (api) => {
  if (typeof api._stopTimers === 'function') api._stopTimers();
};

(async () => {
  // 1. A finished video project: completed renders get media URLs, the withheld
  //    one says why it has none, failed and cancelled renders keep their reason.
  {
    const { api, calls } = makeApi({
      status: {
        P1: {
          id: 'P1',
          status: 'completed',
          finished: true,
          model: { id: 'minimax-h3-ref2va-fp8_r2v', name: 'MiniMax H3', type: 'video' },
          workerJobs: [],
          completedWorkerJobs: [
            { id: 'P1-0', imgID: 'IMG-A', status: 'jobCompleted', reason: 'allJobsCompleted', seedUsed: 42, outputFormat: 'mp4' },
            { id: 'P1-1', imgID: 'IMG-B', status: 'jobCompleted', triggeredNSFWFilter: true },
            { id: 'P1-2', imgID: 'IMG-C', status: 'jobError', reason: 'genfailure' },
            { id: 'P1-3', imgID: 'IMG-D', status: 'jobError', reason: 'artistCanceled' }
          ]
        }
      }
    });
    const result = await api.getResult('P1');
    assert.equal(result.id, 'P1');
    assert.equal(result.finished, true);
    assert.equal(result.modelId, 'minimax-h3-ref2va-fp8_r2v');
    assert.deepEqual(result.jobs, [
      { id: 'IMG-A', status: 'completed', seed: 42, kind: 'video', url: 'https://cdn.test/v1/media/downloadUrl/P1/IMG-A' },
      { id: 'IMG-B', status: 'completed', urlUnavailable: 'sensitiveContent' },
      { id: 'IMG-C', status: 'failed', reason: 'genfailure' },
      { id: 'IMG-D', status: 'canceled', reason: 'artistCanceled' }
    ]);
    assert.ok(!calls.some((c) => c.path === '/v1/image/downloadUrl'), 'video never goes to the image endpoint');
    stop(api);
  }

  // 2. A queued project: no URLs, the server's reason for the wait comes through.
  {
    const waitingReason = {
      reason: 'model_concurrency_limit',
      message: 'Your plan runs one MiniMax H3 video at a time',
      modelFamily: 'minimaxH3'
    };
    const { api } = makeApi({
      status: {
        P2: {
          id: 'P2',
          status: 'queued',
          finished: false,
          waitingReason,
          workerJobs: [{ id: 'P2-0', imgID: 'IMG-Q', status: 'queued' }],
          completedWorkerJobs: []
        }
      }
    });
    const result = await api.getResult('P2');
    assert.equal(result.finished, false);
    assert.equal(result.status, 'queued');
    assert.deepEqual(result.waitingReason, waitingReason);
    assert.deepEqual(result.jobs, [{ id: 'IMG-Q', status: 'queued' }]);
    stop(api);
  }

  // 3. A stored result URL is used as-is; an unknown kind is not guessed, but
  //    the caller's hint is used; a signing failure is reported, not thrown.
  {
    const project = {
      id: 'P3',
      status: 'completed',
      finished: true,
      model: { id: 'some-new-model', name: 'New' },
      workerJobs: [],
      completedWorkerJobs: [
        { id: 'P3-0', imgID: 'IMG-1', status: 'jobCompleted', resultUrl: 'https://vendor.test/out.mp4' },
        { id: 'P3-1', imgID: 'IMG-2', status: 'jobCompleted' }
      ]
    };
    const { api } = makeApi({ status: { P3: project } });
    const unknown = await api.getResult('P3');
    assert.deepEqual(unknown.jobs[0], { id: 'IMG-1', status: 'completed', url: 'https://vendor.test/out.mp4' });
    assert.deepEqual(unknown.jobs[1], { id: 'IMG-2', status: 'completed', urlUnavailable: 'unknownMediaKind' });
    const hinted = await api.getResult('P3', { kind: 'image' });
    assert.equal(hinted.jobs[1].url, 'https://cdn.test/v1/image/downloadUrl/P3/IMG-2');
    stop(api);

    const failing = makeApi({
      status: { P3: project },
      mint: () => {
        throw Object.assign(new Error('Service Unavailable'), { status: 503 });
      }
    });
    const failed = await failing.api.getResult('P3', { kind: 'image' });
    assert.equal(failed.jobs[1].urlUnavailable, 'downloadUrlFailed');
    stop(failing.api);
  }

  // 4. Another account's or an unknown project rejects with the API's 404.
  {
    const { api } = makeApi();
    await assert.rejects(api.getResult('nope'), (error) => error.status === 404);
    stop(api);
  }

  // 5. listRecent reads the durable history for the signed-in address, clamps
  //    the window to 7 days and the limit to 100, and groups renders by project.
  {
    const now = Date.now();
    const history = [
      { id: 'A-0', imgID: 'IMG-A0', status: 'jobCompleted', endTime: now - 5000, parentRequest: { id: 'A', appSource: 'sogni-creative-agent-skill', model: { id: 'minimax-h3-ref2va-fp8_r2v', name: 'H3' } } },
      { id: 'B-0', imgID: 'IMG-B0', status: 'jobCompleted', endTime: now - 1000, parentRequest: { id: 'B', model: { id: 'flux1-schnell-fp8', name: 'Schnell' } } },
      { id: 'A-1', imgID: 'IMG-A1', status: 'jobCompleted', endTime: now - 3000, triggeredNSFWFilter: true, parentRequest: { id: 'A', model: { id: 'minimax-h3-ref2va-fp8_r2v' } } },
      { id: 'orphan', status: 'jobCompleted', endTime: now }
    ];
    const { api, calls } = makeApi({ history });
    api._setAccountAddressResolver(async () => '0xabc');
    const recent = await api.listRecent({ since: now - 30 * 24 * 3600 * 1000, limit: 500, appSource: 'sogni-creative-agent-skill' });
    const query = calls.find((c) => c.path === '/v1/jobs/list').query;
    assert.equal(query.role, 'artist');
    assert.equal(query.address, '0xabc');
    assert.equal(query.state, 'completed');
    assert.equal(query.mediaOnly, true);
    assert.equal(query.limit, 100);
    assert.equal(query.appSource, 'sogni-creative-agent-skill');
    assert.ok(now - query.since < 7 * 24 * 3600 * 1000, 'never asks past the 7-day history');
    assert.deepEqual(recent.map((p) => p.id), ['B', 'A'], 'newest first, orphans dropped');
    assert.deepEqual(recent[1], {
      id: 'A',
      modelId: 'minimax-h3-ref2va-fp8_r2v',
      modelName: 'H3',
      appSource: 'sogni-creative-agent-skill',
      finishedAt: now - 3000,
      jobs: [
        { id: 'IMG-A0', status: 'completed', sensitiveContentWithheld: false, finishedAt: now - 5000 },
        { id: 'IMG-A1', status: 'completed', sensitiveContentWithheld: true, finishedAt: now - 3000 }
      ]
    });

    const defaults = makeApi({ history: [] });
    defaults.api._setAccountAddressResolver(async () => '0xabc');
    await defaults.api.listRecent();
    const defaultQuery = defaults.calls.find((c) => c.path === '/v1/jobs/list').query;
    assert.equal(defaultQuery.limit, 50);
    assert.ok(Math.abs(Date.now() - 24 * 3600 * 1000 - defaultQuery.since) < 5000, 'defaults to the last 24 hours');
    assert.equal('appSource' in defaultQuery, false);
    stop(api);
    stop(defaults.api);
  }

  // 6. Without a signed-in account it says so instead of asking the API globally.
  {
    const { api, calls } = makeApi();
    api._setAccountAddressResolver(async () => undefined);
    await assert.rejects(api.listRecent(), /signed-in account/);
    assert.equal(calls.length, 0);
    stop(api);
  }

  console.log('check-project-results: all assertions passed');
  process.exit(0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
