'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
require('../dist');
const Project = require('../dist/Projects/Project.js').default;
const ProjectsApi = require('../dist/Projects/index.js').default;
const WebSocketClient = require('../dist/ApiClient/WebSocketClient/index.js').default;
const BrowserWebSocketClient =
  require('../dist/ApiClient/WebSocketClient/BrowserWebSocketClient/index.js').default;
const { WebSocketServer } = require('ws');
const {
  normalizeWaitingReason,
  normalizeJobWaitingReasons
} = require('../dist/Projects/types/WaitingReason.js');

const logger = { info() {}, warn() {}, error() {}, debug() {} };
const waitReason = {
  reason: 'concurrency_limit',
  message: 'Your included video slots are in use.',
  mediaType: 'video',
  paymentModel: 'subscription',
  subscriptionTier: 'unlimited'
};
const row = (jobIndex, imgID) => ({
  jobIndex,
  ...(imgID ? { imgID } : {}),
  waitingReason: waitReason
});
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const resources = [];

async function checkSharedQueuePreference() {
  const server = new WebSocketServer({ port: 0 });
  const received = [];
  const clients = [];
  const auth = { isAuthenticated: true, on: () => () => {}, socketOptions: async () => undefined };
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  server.on('connection', (socket) => {
    socket.send(
      JSON.stringify({
        type: 'authenticated',
        data: Buffer.from(JSON.stringify({ clientType: 'artist', activeProjects: [] })).toString(
          'base64'
        )
      })
    );
    socket.on('message', (raw) => {
      const frame = JSON.parse(raw.toString());
      if (frame.type !== 'setSocketEventSubscriptions') return;
      received.push(JSON.parse(Buffer.from(frame.data, 'base64').toString()));
      // Older servers omit an unrecognized optional subscription from acknowledgements.
      socket.send(
        JSON.stringify({
          type: 'socketEventSubscriptionsUpdated',
          data: Buffer.from(
            JSON.stringify({ socketEventSubscriptions: { appAlert: false } })
          ).toString('base64')
        })
      );
    });
  });
  try {
    const url = `http://127.0.0.1:${server.address().port}`;
    clients.push(new BrowserWebSocketClient(url, auth, 'queue-details-test', 'fast', logger));
    await clients[0].coordinator.isReady();
    clients.push(new BrowserWebSocketClient(url, auth, 'queue-details-test', 'fast', logger));
    await clients[1].coordinator.isReady();
    await pause(650);
    const primary = clients.find((client) => client.coordinator.isPrimary);
    const follower = clients.find((client) => !client.coordinator.isPrimary);
    assert.ok(primary && follower);
    // The existing primary's initial handshake did not request the new event.
    primary.socketClient.socketEventSubscriptions = { projectQueue: false };
    await primary.connect();
    await follower.connect();
    for (let retry = 0; retry < 20 && !received.length; retry += 1) await pause(25);
    assert.equal(
      received[0]?.subscriptions?.projectQueue,
      true,
      'a new follower negotiates queue updates through the existing primary'
    );
    await pause(25);
    assert.equal(
      follower.socketClient.socketEventSubscriptions.projectQueue,
      true,
      'old ACK does not erase follower intent'
    );
    await follower.setSocketEventSubscriptions({ unsubscribe: 'projectQueue' });
    await pause(25);
    assert.equal(follower.socketClient.socketEventSubscriptions.projectQueue, false);
    assert.equal(
      primary.socketClient.socketEventSubscriptions.projectQueue,
      false,
      'explicit unsubscribe persists in the connection owner'
    );
  } finally {
    clients.forEach((client) => client.dispose());
    for (const socket of server.clients) socket.terminate();
    await new Promise((resolve) => server.close(resolve));
  }
}

function fixture(numberOfMedia = 2) {
  const client = new EventEmitter();
  client.socket = new EventEmitter();
  client.logger = logger;
  client.auth = new EventEmitter();
  client.auth.sessionVersion = 0;
  client.auth.isAuthenticated = true;
  const api = new ProjectsApi({ client, eip712: {} });
  const project = new Project(
    { type: 'video', modelId: 'test-video', numberOfMedia, positivePrompt: 'x', steps: 10 },
    { api, logger }
  );
  clearInterval(project._timeout);
  project._timeout = null;
  api.projects.push(project);
  resources.push(project);
  const queue = (waitingReason = waitReason, jobWaitingReasons = [row(0), row(1)]) =>
    client.socket.emit('projectQueue', { jobID: project.id, waitingReason, jobWaitingReasons });
  const start = (jobIndex, imgID = `result-${jobIndex}`) =>
    client.socket.emit('jobState', {
      jobID: project.id,
      type: 'jobStarted',
      imgID,
      jobIndex,
      workerName: 'worker'
    });
  return { client, api, project, queue, start };
}

async function main() {
  const first = fixture();
  let events = 0;
  first.api.on('queueChanged', (event) => {
    events += 1;
    assert.deepEqual(
      first.project.toJSON().waitingReason,
      event.waitingReason,
      'state updates before notification'
    );
    assert.deepEqual(first.project.jobWaitingReasons, event.jobWaitingReasons);
  });
  first.queue();
  assert.equal(
    first.project.jobs.length,
    0,
    'index-only queue entries do not create phantom results'
  );
  first.queue();
  assert.equal(events, 1, 'duplicate state does not notify again');
  first.client.socket.emit('jobState', {
    type: 'queued',
    jobID: first.project.id,
    queuePosition: 2,
    queueStatus: 'waiting'
  });
  assert.deepEqual(
    first.project.waitingReason,
    waitReason,
    'legacy queue updates preserve dedicated reasons'
  );
  first.start(1);
  assert.deepEqual(
    first.project.jobWaitingReasons.map((entry) => entry.jobIndex),
    [0]
  );
  const running = first.project.jobs[0];
  const runtimeTimer = running._runtimeTimeout;
  first.queue(waitReason, [row(0), row(1, running.id)]);
  assert.equal(running.status, 'processing');
  assert.equal(
    running.waitingReason ?? null,
    null,
    'stale queue rows do not reattach to running results'
  );
  assert.equal(
    running._runtimeTimeout,
    runtimeTimer,
    'partial batch updates preserve the running timer'
  );
  first.queue(null, []);
  assert.equal(first.project.waitingReason, null);
  assert.deepEqual(first.project.jobWaitingReasons, []);
  first.project._update({ status: 'completed' });
  first.queue();
  assert.equal(first.project.waitingReason, null, 'terminal projects ignore late queue updates');

  const known = fixture();
  const pending = known.project._addJob({
    id: 'existing-result',
    projectId: known.project.id,
    jobIndex: 0,
    status: 'pending',
    step: 0,
    stepCount: 10
  });
  known.queue(waitReason, [row(0)]);
  assert.deepEqual(
    pending.waitingReason,
    waitReason,
    'known pending results match by index without image ID'
  );
  known.queue(null, []);
  assert.equal(pending.waitingReason, null, 'full-list omission clears prior per-result reason');
  known.queue(waitReason, [row(0, 'existing-result')]);
  assert.equal(
    known.project.jobWaitingReasons[0].imgID,
    'existing-result',
    'public IDs preserve server spelling'
  );
  known.start(0, 'replacement-result');
  assert.equal(known.project.jobs.length, 1, 'worker replacement retains existing indexed result');
  assert.equal(known.project.waitingReason, null);

  const indexed = fixture();
  await indexed.api._replayRawProject(
    indexed.project,
    {
      status: 'active',
      workerJobs: [{ imgID: 'recovered-0', jobIndex: 0, status: 'jobStarted' }],
      completedWorkerJobs: [],
      waitingReason: waitReason,
      jobWaitingReasons: [row(0), row(1)]
    },
    true
  );
  assert.equal(indexed.project.job('recovered-0').jobIndex, 0);
  assert.deepEqual(
    indexed.project.jobWaitingReasons,
    [row(1)],
    'recovered assignments clear only their stable indexed queue entry'
  );

  const createdDuringSync = fixture();
  createdDuringSync.api.projects = [];
  const createdResponse = deferred();
  createdDuringSync.client.socket.get = () => createdResponse.promise;
  const creatingSync = createdDuringSync.api.sync();
  createdDuringSync.api.projects.push(createdDuringSync.project);
  const currentReason = { ...waitReason, message: 'Current server explanation.' };
  createdDuringSync.queue(currentReason, [{ jobIndex: 0, waitingReason: currentReason }]);
  createdResponse.resolve({
    activeProjects: [
      {
        id: createdDuringSync.project.id,
        status: 'queued',
        workerJobs: [],
        completedWorkerJobs: [],
        waitingReason: waitReason,
        jobWaitingReasons: [row(0)]
      }
    ],
    unclaimedCompletedProjects: []
  });
  await creatingSync;
  assert.deepEqual(
    createdDuringSync.project.waitingReason,
    currentReason,
    'projects created during a request retain their newer live queue state'
  );

  const retriedDuringReplay = fixture();
  retriedDuringReplay.start(0);
  retriedDuringReplay.start(1);
  const retryReplay = retriedDuringReplay.api._replayRawProject(
    retriedDuringReplay.project,
    {
      status: 'active',
      workerJobs: [0, 1].map((jobIndex) => ({
        imgID: `result-${jobIndex}`,
        jobIndex,
        status: 'jobProgress',
        performedSteps: 3
      })),
      completedWorkerJobs: [],
      waitingReason: null,
      jobWaitingReasons: []
    },
    true
  );
  retriedDuringReplay.client.socket.emit('jobRetry', {
    jobID: retriedDuringReplay.project.id,
    imgID: 'result-1',
    jobIndex: 1
  });
  retriedDuringReplay.queue(waitReason, [row(1, 'result-1')]);
  await retryReplay;
  assert.equal(retriedDuringReplay.project.job('result-1').status, 'pending');
  assert.deepEqual(
    retriedDuringReplay.project.jobWaitingReasons,
    [row(1, 'result-1')],
    'a live retry during replay wins over later stale synthetic assignments'
  );

  const slow = fixture();
  slow.queue();
  const response = deferred();
  slow.client.socket.get = () => response.promise;
  const syncing = slow.api.sync();
  slow.start(0);
  slow.queue(null, []);
  response.resolve({
    activeProjects: [
      {
        id: slow.project.id,
        status: 'queued',
        workerJobs: [],
        completedWorkerJobs: [],
        waitingReason: waitReason,
        jobWaitingReasons: [row(0)]
      }
    ],
    unclaimedCompletedProjects: []
  });
  await syncing;
  assert.equal(
    slow.project.waitingReason,
    null,
    'a response requested before live activity cannot restore its old queue'
  );

  const replay = fixture();
  const download = deferred();
  replay.api.handleJobResult = () => download.promise;
  const replaying = replay.api._replayRawProject(
    replay.project,
    {
      status: 'queued',
      workerJobs: [],
      completedWorkerJobs: [
        { id: 'finished-result', imgID: 'finished-result', status: 'jobCompleted' }
      ],
      waitingReason: waitReason,
      jobWaitingReasons: [row(0)]
    },
    true
  );
  assert.deepEqual(replay.project.waitingReason, waitReason);
  replay.queue(null, []);
  download.resolve();
  await replaying;
  assert.equal(
    replay.project.waitingReason,
    null,
    'slow media recovery does not overwrite a newer clear'
  );

  const chained = fixture();
  const chain = deferred();
  chained.api._syncChain = chain.promise;
  chained.client.socket.get = async () => ({
    activeProjects: [
      {
        id: chained.project.id,
        status: 'queued',
        workerJobs: [],
        completedWorkerJobs: [],
        waitingReason: waitReason,
        jobWaitingReasons: [row(0)]
      }
    ],
    unclaimedCompletedProjects: []
  });
  const queuedSync = chained.api.sync();
  await Promise.resolve();
  chained.queue(null, []);
  chain.resolve();
  await queuedSync;
  assert.equal(
    chained.project.waitingReason,
    null,
    'queued reconciliation retains request-start watermark'
  );

  const rest = fixture();
  const restResponse = deferred();
  rest.api.get = () => restResponse.promise;
  const restSync = rest.project._syncToServer();
  rest.queue(null, []);
  restResponse.resolve({
    status: 'queued',
    imageCount: 2,
    stepCount: 10,
    completedWorkerJobs: [],
    waitingReason: waitReason,
    jobWaitingReasons: [row(0)]
  });
  await restSync;
  assert.equal(rest.project.waitingReason, null, 'REST sync also respects newer live state');

  const notices = fixture();
  let clearingNotices = 0;
  notices.api.on('queueChanged', (event) => {
    if (event.waitingReason === null) clearingNotices += 1;
  });
  notices.queue();
  notices.api.get = async () => ({
    status: 'queued',
    imageCount: 2,
    stepCount: 10,
    completedWorkerJobs: []
  });
  await notices.project._syncToServer();
  assert.equal(clearingNotices, 1, 'REST clear notifies dedicated listeners');
  notices.queue();
  notices.project._update({ status: 'completed' });
  assert.equal(clearingNotices, 2, 'terminal clear notifies dedicated listeners');

  const timer = fixture();
  timer.start(0);
  const stopped = timer.project.jobs[0];
  stopped._stopRuntimeTimeout();
  stopped._update({ waitingReason: waitReason });
  assert.equal(
    stopped._runtimeTimeout,
    null,
    'queue-only metadata cannot rearm a stopped runtime timer'
  );
  timer.queue(null, []);
  assert.equal(stopped.waitingReason, null);
  assert.equal(stopped._runtimeTimeout, null);

  const disconnected = fixture();
  disconnected.queue();
  const oldResponse = deferred();
  disconnected.client.socket.get = () => oldResponse.promise;
  const oldSync = disconnected.api.sync();
  disconnected.api.handleTransportLost();
  assert.equal(
    disconnected.project.waitingReason,
    null,
    'a transport gap invalidates current queue explanations'
  );
  oldResponse.resolve({
    activeProjects: [
      {
        id: disconnected.project.id,
        status: 'queued',
        workerJobs: [],
        completedWorkerJobs: [],
        waitingReason: waitReason,
        jobWaitingReasons: [row(0)]
      }
    ],
    unclaimedCompletedProjects: []
  });
  await oldSync;
  assert.equal(
    disconnected.project.waitingReason,
    null,
    'pre-disconnect snapshots cannot restore a stale reason'
  );

  const session = fixture();
  session.queue();
  session.client.auth.sessionVersion += 1;
  session.client.auth.emit('sessionChanged');
  session.queue();
  assert.equal(
    session.project.waitingReason,
    null,
    'old account projects receive no new queue data'
  );

  assert.equal(normalizeWaitingReason({ ...waitReason, reason: 'future-reason' }), null);
  assert.equal(normalizeWaitingReason({ ...waitReason, message: 'x'.repeat(601) }), null);
  assert.deepEqual(normalizeWaitingReason({ ...waitReason, arbitrary: 100 }), waitReason);
  assert.equal(
    normalizeWaitingReason({ ...waitReason, paymentModel: ['subscription'] }).paymentModel,
    undefined
  );
  assert.deepEqual(normalizeJobWaitingReasons([row(0), row(-1)], 2), [row(0)]);
  assert.deepEqual(normalizeJobWaitingReasons([row(2), row(0)], 2), [row(0)]);
  assert.deepEqual(normalizeJobWaitingReasons([row(0), row(0)], 2), [row(0)]);

  const auth = { isAuthenticated: true, on: () => () => {} };
  const ws = new WebSocketClient(
    'https://socket.example.test',
    auth,
    'app',
    'fast',
    logger,
    undefined,
    { modelAvailability: false }
  );
  ws.send = async () => {};
  assert.equal(ws.socketEventSubscriptions.projectQueue, true);
  assert.equal(ws.socketEventSubscriptions.modelAvailability, false);
  ws.emit('socketEventSubscriptionsUpdated', { socketEventSubscriptions: { appAlert: true } });
  assert.equal(
    ws.socketEventSubscriptions.projectQueue,
    true,
    'older acknowledgements retain default queue intent'
  );
  await ws.setSocketEventSubscriptions({ unsubscribe: 'projectQueue' });
  ws.emit('socketEventSubscriptionsUpdated', { socketEventSubscriptions: {} });
  assert.equal(
    ws.socketEventSubscriptions.projectQueue,
    false,
    'explicit opt-out survives old acknowledgements'
  );
  await ws.setSocketEventSubscriptions({ subscribe: 'projectQueue' });
  await ws.setSocketEventSubscriptions({ reset: true });
  ws.emit('socketEventSubscriptionsUpdated', { socketEventSubscriptions: {} });
  assert.equal(
    ws.socketEventSubscriptions.projectQueue,
    false,
    'reset does not re-enable the optional stream'
  );
  await checkSharedQueuePreference();
  console.log('check-queue-reasons: ALL TESTS PASSED');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => resources.forEach((project) => project._dispose()));
