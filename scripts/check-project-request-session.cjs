'use strict';

// Local request/session regressions; no account, uploads or generation service is contacted.
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const ProjectsApi = require('../dist/Projects/index.js').default;
const ReusableUploads = require('../dist/Projects/ReusableUploads.js').default;
const CookieAuthManager = require('../dist/lib/AuthManager/CookieAuthManager.js').default;
const RestClient = require('../dist/lib/RestClient.js').default;
const WebSocketClient = require('../dist/ApiClient/WebSocketClient/index.js').default;
const BrowserWebSocketClient =
  require('../dist/ApiClient/WebSocketClient/BrowserWebSocketClient/index.js').default;
const { captureRequestSession } = require('../dist/lib/requestSession.js');
const {
  MessageDeliveryUncertainError
} = require('../dist/ApiClient/WebSocketClient/requestDelivery.js');
const { ApiError } = require('../dist/ApiClient/index.js');
const ApiClient = require('../dist/ApiClient/index.js').default;
const logger = { info() {}, warn() {}, error() {}, debug() {} };
const changed = /account changed/i;
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const options = {
  type: 'image',
  steps: { min: 1, max: 1, step: 1, default: 1 },
  guidance: { min: 0, max: 1, step: 0.1, default: 0 },
  sampler: { allowed: [], default: null },
  scheduler: { allowed: [], default: null }
};
const params = {
  type: 'image',
  modelId: 'birefnet_image_background_removal_fp16',
  positivePrompt: '',
  numberOfMedia: 1,
  startingImage: new Blob(['image'], { type: 'image/png' })
};
async function makeApi() {
  const auth = new CookieAuthManager(logger);
  auth._setSessionIdentity('account-a');
  await auth.authenticate();
  const sent = [];
  const urls = [];
  const client = Object.assign(new EventEmitter(), {
    auth,
    logger,
    socket: Object.assign(new EventEmitter(), {
      send: async (type, data) => {
        sent.push({ type, data });
      }
    }),
    rest: {
      auth,
      get: async (path) => {
        urls.push(path);
        return { data: { uploadUrl: 'https://uploads.example.test/old-session' } };
      }
    }
  });
  client.on = function (type, listener) {
    EventEmitter.prototype.on.call(this, type, listener);
    return () => this.off(type, listener);
  };
  const api = new ProjectsApi({ client, eip712: {} });
  api.getModelOptions = async () => options;
  api._assets = { tryBindFile: async () => false };
  return { api, auth, client, sent, urls };
}
async function changeAccount(auth, identity = 'account-b') {
  auth.clear();
  auth._setSessionIdentity(identity);
  await auth.authenticate();
}

async function checkPreparation() {
  for (const identity of ['account-a', 'account-b']) {
    const { api, auth, sent, urls } = await makeApi();
    const model = deferred();
    api.getModelOptions = () => model.promise;
    const pending = api.create(params);
    const rejected = assert.rejects(pending, changed);
    await changeAccount(auth, identity);
    model.resolve(options);
    await rejected;
    assert.equal(urls.length, 0);
    assert.equal(sent.length, 0);
    assert.equal(api._preparingSessions.size, 0);
  }
  for (const boundary of ['bind', 'url', 'put']) {
    const { api, auth, client, sent, urls } = await makeApi();
    const gate = deferred();
    const started = deferred();
    let writes = 0;
    if (boundary === 'bind')
      api._assets.tryBindFile = () => {
        started.resolve();
        return gate.promise;
      };
    if (boundary === 'url')
      client.rest.get = () => {
        started.resolve();
        return gate.promise;
      };
    global.fetch = async () => {
      writes += 1;
      if (boundary === 'put') {
        started.resolve();
        return gate.promise;
      }
      return { ok: true };
    };
    const pending = api.create(params);
    const rejected = assert.rejects(pending, changed);
    await started.promise;
    await changeAccount(auth);
    gate.resolve(
      boundary === 'bind'
        ? false
        : boundary === 'url'
          ? { data: { uploadUrl: 'https://uploads.example.test/file' } }
          : { ok: true }
    );
    await rejected;
    assert.equal(writes, boundary === 'put' ? 1 : 0, 'no new transfer after session change');
    if (boundary === 'bind') assert.equal(urls.length, 0);
    assert.equal(sent.length, 0, 'an old-session project never reaches jobRequest');
  }
  const { api, auth, sent } = await makeApi();
  const upload = deferred();
  const started = deferred();
  global.fetch = () => {
    started.resolve();
    return upload.promise;
  };
  const pending = [api.create(params), api.create(params)];
  await started.promise;
  await auth.authenticate(); // Same-account refresh is not a session boundary.
  upload.resolve({ ok: true });
  const projects = await Promise.all(pending);
  assert.equal(sent.length, 2);
  projects.forEach((project) => project._dispose());
}

async function checkReusableUploads() {
  const { auth } = await makeApi();
  const capability = deferred();
  const uploads = new ReusableUploads({ auth, get: () => capability.promise });
  const pending = uploads.tryBindFile(params.startingImage, 'image/png', {
    projectId: 'project',
    type: 'startingImage'
  });
  const rejected = assert.rejects(pending, changed);
  await changeAccount(auth);
  capability.resolve({ data: { enabled: false } });
  await rejected;

  const prepare = deferred();
  const preparing = deferred();
  const quotaUploads = new ReusableUploads({
    auth,
    get: async () => ({ data: { enabled: true } }),
    post: async () => {
      preparing.resolve();
      await prepare.promise;
      throw new ApiError(409, {
        status: 'error',
        errorCode: 0,
        message: 'Your saved upload library is full.'
      });
    }
  });
  const old = quotaUploads.tryBindFile(params.startingImage, 'image/png', {
    projectId: 'old',
    type: 'startingImage'
  });
  const oldRejected = assert.rejects(old, changed);
  await preparing.promise;
  await changeAccount(auth, 'account-c');
  prepare.resolve();
  await oldRejected;
  assert.equal(quotaUploads.automaticSaveBlockedUntil, 0);
}

async function checkLateSubmission() {
  for (const uncertain of [false, true]) {
    const { api, auth, client } = await makeApi();
    const submitted = deferred();
    const acknowledgement = deferred();
    global.fetch = async () => ({ ok: true });
    client.socket.send = async () => {
      submitted.resolve();
      await acknowledgement.promise;
      if (uncertain) throw new MessageDeliveryUncertainError();
    };
    const pending = api.create(params);
    const rejected = assert.rejects(
      pending,
      /Your account changed while this request was being submitted\. It may still be running in your previous account\. Check its creations before submitting again\./
    );
    await submitted.promise;
    await changeAccount(auth);
    acknowledgement.resolve();
    try {
      await rejected;
      assert.equal(
        api.projects.length,
        0,
        'late send completion cannot repopulate another account'
      );
      assert.equal(api._unadmittedRequests.size, 0);
      assert.equal(api._sentOnGeneration.size, 0);
    } finally {
      api.projects.forEach((project) => project._dispose());
    }
  }
}

async function checkRecoverySession() {
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const pendingTimers = new Set();
  const { api: disposedApi, auth: disposedAuth, client: disposedClient } = await makeApi();
  global.fetch = async () => ({ ok: true });
  const disposedProject = await disposedApi.create(params);
  try {
    global.setTimeout = (callback, delay, ...args) => {
      const timer = originalSetTimeout(callback, delay, ...args);
      pendingTimers.add(timer);
      return timer;
    };
    global.clearTimeout = (timer) => {
      pendingTimers.delete(timer);
      return originalClearTimeout(timer);
    };
    const listeners = disposedClient.listenerCount('connected');
    assert.equal(
      disposedApi._resubmitAfterReconnect(disposedProject.id, 'Server is restarting'),
      true
    );
    assert.equal(pendingTimers.size, 1);
    await changeAccount(disposedAuth);
    assert.equal(pendingTimers.size, 0, 'session cleanup cancels the pending reconnect timeout');
    assert.equal(
      disposedClient.listenerCount('connected'),
      listeners,
      'session cleanup removes the pending reconnect listener'
    );
  } finally {
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
    for (const timer of pendingTimers) originalClearTimeout(timer);
    disposedProject._dispose();
    originalClearTimeout(disposedApi._recheckTimer);
  }
  for (const mode of ['restart', 'undelivered']) {
    for (const switchAccount of [true, false]) {
      const { api, auth, client, sent } = await makeApi();
      global.fetch = async () => ({ ok: true });
      const project = await api.create(params);
      try {
        if (mode === 'restart') {
          assert.equal(api._resubmitAfterReconnect(project.id, 'Server is restarting'), true);
        }
        if (switchAccount) {
          auth._setSessionIdentity('account-b');
          await auth.authenticate();
        } else {
          await auth.authenticate();
        }
        assert.equal(
          api.trackedProjects.length,
          switchAccount ? 0 : 1,
          'only a session boundary clears retained projects'
        );
        if (mode === 'restart') {
          client.emit('connected', { network: 'fast' });
          await new Promise((resolve) => setImmediate(resolve));
        } else {
          api._transportGeneration += 1;
          api.transportDisconnected = false;
          assert.equal(await api._resendUndelivered(project.id), !switchAccount);
        }
        assert.equal(
          sent.length,
          switchAccount ? 1 : 2,
          `${mode} preserves the original submission account`
        );
      } finally {
        project._dispose();
        if (api._recheckTimer) clearTimeout(api._recheckTimer);
      }
    }
  }
  for (const mode of ['restart', 'undelivered']) {
    for (const uncertain of [false, true]) {
      const { api, auth, client } = await makeApi();
      global.fetch = async () => ({ ok: true });
      const project = await api.create(params);
      const submitted = deferred();
      const acknowledgement = deferred();
      client.socket.send = async () => {
        submitted.resolve();
        await acknowledgement.promise;
        if (uncertain) throw new MessageDeliveryUncertainError();
      };
      let resending;
      try {
        if (mode === 'restart') {
          api._resubmitAfterReconnect(project.id, 'Server is restarting');
          client.emit('connected', { network: 'fast' });
        } else {
          api._transportGeneration += 1;
          api.transportDisconnected = false;
          resending = api._resendUndelivered(project.id);
        }
        await submitted.promise;
        await changeAccount(auth);
        acknowledgement.resolve();
        if (resending) assert.equal(await resending, false);
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(
          Boolean(api._recheckTimer),
          false,
          'late retry completion cannot schedule recovery in the new account'
        );
        if (mode === 'restart') assert.equal(api._unadmittedRequests.has(project.id), false);
        else assert.equal(api._sentOnGeneration.has(project.id), false);
      } finally {
        project._dispose();
        if (api._recheckTimer) clearTimeout(api._recheckTimer);
      }
    }
  }
}

async function checkRecoverySnapshots() {
  const recovered = {
    id: 'account-a-project',
    status: 'queued',
    jobType: 'image',
    model: { id: params.modelId, type: 'image' },
    imageCount: 1,
    stepCount: 1,
    createTime: Date.now(),
    workerJobs: [],
    completedWorkerJobs: []
  };
  const snapshot = { activeProjects: [recovered], unclaimedCompletedProjects: [] };
  for (const switchAccount of [true, false]) {
    const { api, auth } = await makeApi();
    const gate = deferred();
    api._syncChain = gate.promise;
    const events = [];
    api.on('projectsSynced', (event) => events.push(event));
    const pending = api._queueSync(snapshot, 'manual', Date.now());
    const outcome = switchAccount ? assert.rejects(pending, changed) : pending;
    if (switchAccount) await changeAccount(auth);
    else await auth.authenticate();
    gate.resolve();
    try {
      await outcome;
      assert.equal(
        events.length,
        switchAccount ? 0 : 1,
        'queued snapshot belongs to its original account'
      );
      assert.equal(api.trackedProjects.length, switchAccount ? 0 : 1);
    } finally {
      api.trackedProjects.forEach((project) => project._dispose());
    }
  }

  for (const boundary of ['snapshot', 'result', 'missing']) {
    const { api, auth, client } = await makeApi();
    const gate = deferred();
    const started = deferred();
    const events = [];
    api.on('job', (event) => events.push(event));
    api.on('projectsSynced', (event) => events.push(event));
    if (boundary === 'snapshot') {
      client.socket.get = () => {
        started.resolve();
        return gate.promise;
      };
    } else if (boundary === 'missing') {
      global.fetch = async () => ({ ok: true });
      const project = await api.create(params);
      project.data.startedAt = new Date(0);
      api._recoveryTuning.recentlyCreatedGraceMs = 0;
      client.socket.get = async () => ({ activeProjects: [], unclaimedCompletedProjects: [] });
      api.resolveMissing = () => {
        started.resolve();
        return gate.promise;
      };
    } else {
      client.socket.get = async () => ({
        activeProjects: [],
        unclaimedCompletedProjects: [
          {
            ...recovered,
            status: 'completed',
            completedWorkerJobs: [{ id: 'a-job', status: 'jobCompleted' }]
          }
        ]
      });
      api.downloadUrl = () => {
        started.resolve();
        return gate.promise;
      };
    }
    const pending = api.sync();
    const rejected = assert.rejects(pending, changed);
    await started.promise;
    await changeAccount(auth);
    gate.resolve(boundary === 'snapshot' ? snapshot : 'https://results.example.test/account-a');
    await rejected;
    assert.equal(api.trackedProjects.length, 0);
    assert.deepEqual(events, [], 'stale recovery cannot publish snapshots or result events');
  }
}

async function checkTransport() {
  const { auth } = await makeApi();
  const rest = new RestClient('https://api.example.test', auth, logger);
  const headers = deferred();
  auth.authenticateRequest = () => headers.promise;
  let writes = 0;
  global.fetch = async () => {
    writes += 1;
    return { ok: true, text: async () => '{}' };
  };
  const request = rest.get('/test');
  const rejected = assert.rejects(request, changed);
  await changeAccount(auth);
  headers.resolve({});
  await rejected;
  assert.equal(writes, 0);

  const ready = deferred();
  const socket = new WebSocketClient('https://socket.example.test', auth, 'test', 'fast', logger);
  socket.socket = {
    send() {
      writes += 1;
    }
  };
  socket._connectionSessionVersion = auth.sessionVersion;
  socket.waitForConnection = () => ready.promise;
  const sending = socket.send('jobRequest', { jobID: 'old' });
  const sendingRejected = assert.rejects(sending, changed);
  await changeAccount(auth);
  ready.resolve();
  await sendingRejected;
  assert.equal(writes, 0);
  assert.equal(
    socket.isConnected,
    false,
    'old authenticated socket is not reused for a new account'
  );
  let closes = 0;
  socket.socket.close = () => {
    closes += 1;
  };
  ApiClient.prototype.handleAuthUpdated.call({ socket, _clearReconnect() {} }, false);
  assert.equal(closes, 1, 'logout closes a socket even after its session was invalidated');
  assert.equal(socket.socket, null);

  const unhandled = [];
  const onUnhandled = (error) => unhandled.push(error);
  process.on('unhandledRejection', onUnhandled);
  try {
    for (const owner of ['api', 'handoff']) {
      const credentials = deferred();
      auth.socketOptions = () => credentials.promise;
      const connecting = new WebSocketClient(
        'https://socket.example.test',
        auth,
        'test',
        'fast',
        logger
      );
      if (owner === 'api') {
        ApiClient.prototype.handleAuthUpdated.call(
          {
            socket: connecting,
            logger,
            _disableSocket: false,
            handleSocketConnecting() {}
          },
          true
        );
      } else {
        const browser = browserStub(auth, true);
        browser.socketClient = connecting;
        browser._wantConnected = true;
        browser.handleRoleChange(true);
      }
      await changeAccount(auth);
      credentials.resolve();
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(connecting.socket, null, 'stale connection credentials never open a socket');
    }
    assert.deepEqual(unhandled, [], 'automatic connection rejects are consumed');
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
}

function browserStub(auth, primary) {
  const browser = Object.create(BrowserWebSocketClient.prototype);
  Object.assign(browser, {
    _auth: auth,
    _logger: logger,
    _sessionVersion: auth.sessionVersion,
    _sessionId: 'shared-session',
    _staleSessionIds: new Set(),
    coordinator: { isPrimary: primary, isReady: async () => {}, notify() {} },
    socketClient: { send: async () => {}, isConnected: true }
  });
  return browser;
}
async function checkBrowserForwarding() {
  const { auth } = await makeApi();
  const secondary = browserStub(auth, false);
  const { auth: primaryAuth } = await makeApi();
  const primary = browserStub(primaryAuth, true);
  const queued = deferred();
  const queuedRequest = deferred();
  let forwards = 0;
  primary.socketClient.send = async () => {
    forwards += 1;
  };
  secondary.coordinator.sendMessage = async (message) => {
    queuedRequest.resolve(message);
    await queued.promise;
    return primary.handleMessage(message);
  };
  const pending = secondary.send('jobRequest', { jobID: 'queued' });
  const rejected = assert.rejects(pending, changed);
  const message = await queuedRequest.promise;
  assert.equal(message.sessionId, 'shared-session');
  assert.equal(JSON.stringify(message).includes('account-a'), false);
  await changeAccount(primaryAuth);
  queued.resolve();
  await rejected;
  assert.equal(forwards, 0);

  // A follower can remain authenticated while another tab directly replaces
  // the account. Its already-running project preparation must still stop.
  const preparing = await makeApi();
  const model = deferred();
  preparing.api.getModelOptions = () => model.promise;
  const preparation = preparing.api.create(params);
  const rejectedPreparation = assert.rejects(preparation, changed);
  await browserStub(preparing.auth, false).handleNotification({
    type: 'auth-state-changed',
    payload: true,
    sessionChanged: true
  });
  model.resolve(options);
  await rejectedPreparation;
  assert.equal(preparing.sent.length, 0);
  assert.equal(preparing.urls.length, 0);

  const ready = browserStub(auth, true);
  ready.socketClient.send = async () => {
    forwards += 1;
  };
  await auth.authenticate();
  await ready.handleMessage({
    type: 'socket-send',
    sessionId: 'shared-session',
    payload: { type: 'jobRequest', data: { jobID: 'refresh' } }
  });
  assert.equal(forwards, 1, 'same-account refresh preserves shared-session requests');
  await assert.rejects(
    ready.handleMessage({
      type: 'socket-send',
      payload: { type: 'jobRequest', data: { jobID: 'old-sdk' } }
    }),
    /Reload your other Sogni tabs/
  );

  const oldPrimary = browserStub(auth, false);
  oldPrimary._sessionId = null;
  oldPrimary.connect = async () => {}; // Old primary does not supply session context.
  await assert.rejects(
    oldPrimary.send('jobRequest', { jobID: 'mixed-version' }),
    /Reload your other Sogni tabs/
  );

  const follower = browserStub(auth, false);
  const assertOriginalSession = captureRequestSession(auth);
  await follower.handleNotification({
    type: 'auth-state-changed',
    payload: true,
    sessionChanged: true
  });
  assert.throws(
    assertOriginalSession,
    changed,
    'same-boolean account replacement invalidates preparation'
  );
  const handoff = browserStub(auth, false);
  handoff.coordinator.isPrimary = true;
  handoff.syncSessionContext();
  assert.equal(
    handoff._sessionId,
    'shared-session',
    'leader change keeps the authenticated session marker'
  );
}

async function checkLateSocketEvents() {
  const { auth } = await makeApi();
  const follower = browserStub(auth, false);
  const events = [];
  follower.emit = (type, data) => events.push({ type, data });
  follower._lastBalanceUpdate = { balance: 'old' };
  follower._lastSubscriptionEntitlement = { status: 'old' };
  await changeAccount(auth);
  await follower.handleNotification({
    type: 'socket-event',
    sessionId: 'shared-session',
    payload: { type: 'authenticated', data: { activeProjects: ['old-account'] } }
  });
  await follower.handleNotification({ type: 'session-context', sessionId: 'shared-session' });
  await follower.handleNotification({
    type: 'socket-event',
    payload: { type: 'authenticated', data: { activeProjects: ['old-sdk'] } }
  });
  assert.deepEqual(events, [], 'old or unverified account frames cannot enter the new session');
  assert.equal(follower._sessionId, null);
  assert.equal(follower._lastBalanceUpdate, null);
  assert.equal(follower._lastSubscriptionEntitlement, null);
  follower._sessionRequestId = 'current-request';
  await follower.handleNotification({
    type: 'session-context',
    sessionId: 'unknown-old-session',
    sessionRequestId: 'old-request'
  });
  await follower.handleNotification({
    type: 'socket-event',
    sessionId: 'unknown-old-session',
    payload: { type: 'authenticated', data: { activeProjects: ['unknown-old-account'] } }
  });
  assert.equal(
    events.length,
    0,
    'an unknown old session cannot be adopted before current context discovery'
  );
  await follower.handleNotification({
    type: 'session-context',
    sessionId: 'new-session',
    sessionRequestId: 'current-request'
  });
  await follower.handleNotification({
    type: 'socket-event',
    sessionId: 'new-session',
    payload: { type: 'authenticated', data: { activeProjects: [] } }
  });
  assert.equal(events.length, 1, 'current-session frames are still delivered');

  const discovering = browserStub(auth, false);
  discovering._sessionId = null;
  const primary = browserStub(auth, true);
  primary._sessionId = 'newly-discovered-session';
  primary.coordinator.notify = (notification) => discovering.handleNotification(notification);
  // Connect replay may include events; the same request establishes their session first.
  discovering.emit = () => {};
  let connectRequests = 0;
  let sentRequests = 0;
  discovering.coordinator.sendMessage = async (message) => {
    if (message.type === 'connect') connectRequests += 1;
    else sentRequests += 1;
    return primary.handleMessage(message);
  };
  await Promise.all([
    discovering.send('jobRequest', { jobID: 'concurrent-one' }),
    discovering.send('jobRequest', { jobID: 'concurrent-two' })
  ]);
  assert.equal(connectRequests, 1, 'concurrent creates share context discovery');
  assert.equal(sentRequests, 2);

  const promoted = browserStub(auth, true);
  promoted._sessionId = null;
  promoted.syncSessionContext();
  const established = browserStub(auth, false);
  established._wantConnected = true;
  const handoffEvents = [];
  established.emit = (type) => handoffEvents.push(type);
  promoted.coordinator.notify = (notification) => established.handleNotification(notification);
  let discoveries = 0;
  established.coordinator.sendMessage = async (message) => {
    discoveries += 1;
    return promoted.handleMessage(message);
  };
  await established.handleNotification({
    type: 'socket-event',
    sessionId: promoted._sessionId,
    payload: { type: 'authenticated', data: { activeProjects: [] } }
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(discoveries, 1, 'an established follower rediscovers a contextless promoted leader');
  assert.equal(established._sessionId, promoted._sessionId);
  assert.deepEqual(
    handoffEvents,
    ['connected'],
    'only verified replay is accepted after discovery'
  );

  const socket = new WebSocketClient('https://socket.example.test', auth, 'test', 'fast', logger);
  const source = {};
  socket.socket = source;
  socket._connectionSessionVersion = auth.sessionVersion;
  let received = 0;
  socket.on('authenticated', () => {
    received += 1;
  });
  const frame = {
    target: source,
    data: Buffer.from(
      JSON.stringify({
        type: 'authenticated',
        data: Buffer.from(JSON.stringify({ clientType: 'artist' })).toString('base64')
      })
    )
  };
  socket.handleMessage(frame);
  await changeAccount(auth);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(received, 0, 'decoding an old frame cannot publish it in a new auth session');
  socket._connectionSessionVersion = auth.sessionVersion;
  socket.handleMessage(frame);
  socket.socket = {};
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(received, 0, 'a replaced socket cannot publish its pending frames');
  socket.socket = source;
  socket.handleMessage(frame);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(received, 1, 'the current socket still publishes its frames');
  socket.socket = null;
}

async function main() {
  const originalFetch = global.fetch;
  try {
    await checkPreparation();
    await checkLateSubmission();
    await checkRecoverySession();
    await checkRecoverySnapshots();
    await checkReusableUploads();
    await checkTransport();
    await checkBrowserForwarding();
    await checkLateSocketEvents();
    process.stdout.write(
      'Project request session checks passed: preparation, uploads, refresh, transport, and browser forwarding.\n'
    );
  } finally {
    global.fetch = originalFetch;
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
