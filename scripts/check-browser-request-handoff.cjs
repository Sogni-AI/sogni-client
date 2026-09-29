'use strict';

// Real BroadcastChannel + loopback WebSocket coverage of secondary-tab sends.
// No production service, credentials, or generations are involved.
const assert = require('node:assert/strict');
const { mock } = require('node:test');
const { WebSocketServer } = require('ws');
require('../dist/index.js');
const BrowserWebSocketClient =
  require('../dist/ApiClient/WebSocketClient/BrowserWebSocketClient/index.js').default;
const ChannelCoordinator =
  require('../dist/ApiClient/WebSocketClient/BrowserWebSocketClient/ChannelCoordinator.js').default;
const WebSocketClient = require('../dist/ApiClient/WebSocketClient/index.js').default;
const ApiClient = require('../dist/ApiClient/index.js').default;
const CookieAuthManager = require('../dist/lib/AuthManager/CookieAuthManager.js').default;
const {
  MessageDeliveryUncertainError,
  REQUEST_ACK_TIMEOUT_MS
} = require('../dist/ApiClient/WebSocketClient/requestDelivery.js');

const logger = { info() {}, warn() {}, error() {}, debug() {} };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const auth = { isAuthenticated: true, on: () => () => {}, socketOptions: async () => undefined };
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

async function checkSlowReconnect() {
  const server = new WebSocketServer({ port: 0 });
  const received = [];
  let authDelay = 0;
  const timers = [];
  server.on('connection', (socket) => {
    socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.type !== 'jobRequest') return;
      assert.equal(socket.authenticated, true, 'work only arrives after authentication');
      received.push(JSON.parse(Buffer.from(message.data, 'base64').toString()));
    });
    timers.push(
      setTimeout(() => {
        socket.authenticated = true;
        socket.send(
          JSON.stringify({
            type: 'authenticated',
            data: Buffer.from(
              JSON.stringify({ clientType: 'artist', activeProjects: [] })
            ).toString('base64')
          })
        );
      }, authDelay)
    );
  });
  const clients = [];
  try {
    const url = `http://127.0.0.1:${server.address().port}`;
    clients.push(new BrowserWebSocketClient(url, auth, 'handoff-test', 'fast', logger));
    await clients[0].coordinator.isReady();
    clients.push(new BrowserWebSocketClient(url, auth, 'handoff-test', 'fast', logger));
    await clients[1].coordinator.isReady();
    await sleep(650);
    const primary = clients.find((client) => client.coordinator.isPrimary);
    const secondary = clients.find((client) => !client.coordinator.isPrimary);
    assert.ok(primary && secondary, 'one primary and one secondary');
    await primary.connect();
    await primary.send('jobRequest', { jobID: 'DIRECT' });
    await secondary.send('jobRequest', { jobID: 'HEALTHY' });
    await sleep(50);
    assert.deepEqual(
      received.map((request) => request.jobID),
      ['DIRECT', 'HEALTHY']
    );

    // Emulate ApiClient reconnecting after a recoverable server close. The
    // primary's next authenticated handshake takes longer than the old ACK.
    authDelay = 6000;
    const disconnected = new Promise((resolve) =>
      primary.socketClient.once('disconnected', resolve)
    );
    for (const socket of server.clients) socket.close(1001, 'Server is restarting');
    await disconnected;
    let settled = false;
    const sending = secondary.send('jobRequest', { jobID: 'AFTER-RECONNECT' });
    sending.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      }
    );
    await primary.socketClient.connect();
    await sleep(5200);
    assert.equal(settled, false, 'the secondary must not report failure at five seconds');
    assert.equal(received.length, 2, 'no frame sent before authentication');
    await sending;
    await sleep(50);
    assert.deepEqual(
      received.map((request) => request.jobID),
      ['DIRECT', 'HEALTHY', 'AFTER-RECONNECT'],
      'the pending request is delivered exactly once'
    );

    // Definitive socket failures still propagate across the channel.
    const closed = new Promise((resolve) => primary.socketClient.once('disconnected', resolve));
    for (const socket of server.clients) socket.close(1001, 'Server is restarting');
    await closed;
    const rejected = secondary.send('jobRequest', { jobID: 'REJECTED' });
    const rejection = assert.rejects(rejected, /connection failed/);
    await primary.socketClient.connect();
    await sleep(80);
    for (const socket of server.clients) socket.close(4021, 'Authentication error');
    await rejection;
    assert.equal(received.length, 3, 'a rejected request never reaches the wire');
  } finally {
    timers.forEach(clearTimeout);
    for (const client of clients) {
      client.socketClient.disconnect();
      clearInterval(client.coordinator.heartbeatTimer);
      clearInterval(client.coordinator.primaryCheckTimer);
      client.coordinator.channel.close();
    }
    for (const socket of server.clients) socket.terminate();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function checkMissingAckAndSuspension() {
  mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: 100_000 });
  try {
    // Isolate channel delivery from election timers to control a lost ACK and
    // a message queued while its receiver is suspended.
    const posted = [];
    const secondary = Object.assign(Object.create(ChannelCoordinator.prototype), {
      id: 'secondary',
      _isPrimary: false,
      lastPrimaryHeartbeat: Date.now(),
      electionInProgress: false,
      ackCallbacks: {},
      logger,
      channel: { postMessage: (envelope) => posted.push(envelope) }
    });
    let settled = false;
    // Control messages keep the short ACK window; only forwarded socket sends
    // wait out the primary's readiness window.
    const control = assert.rejects(
      secondary.sendMessage({ type: 'connect' }),
      MessageDeliveryUncertainError
    );
    await flush();
    mock.timers.tick(5000);
    await control;
    posted.length = 0;
    secondary.lastPrimaryHeartbeat = Date.now();

    const sending = secondary.sendMessage(
      {
        type: 'socket-send',
        sessionId: 'test-session',
        payload: { type: 'jobRequest', data: { jobID: 'LATE' } }
      },
      REQUEST_ACK_TIMEOUT_MS
    );
    sending.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      }
    );
    const rejection = assert.rejects(sending, MessageDeliveryUncertainError);
    await flush();
    mock.timers.tick(30_000);
    await flush();
    assert.equal(settled, false, 'allow the full socket readiness window');
    mock.timers.tick(5000);
    await rejection;
    assert.equal(
      Object.keys(secondary.ackCallbacks).length,
      0,
      'expired ACK callbacks are removed'
    );

    // The primary runs the real forwarding path into a ready socket, so only
    // the sender's deadline can keep the frame off the wire.
    const forwarded = [];
    const readySocket = { readyState: 1, send: (data) => forwarded.push(data) };
    const primarySocket = new WebSocketClient(
      'http://127.0.0.1',
      auth,
      'late-test',
      'fast',
      logger
    );
    primarySocket.socket = readySocket;
    primarySocket._authenticatedSocket = readySocket;
    let connects = 0;
    primarySocket.connect = async () => {
      connects++;
    };
    const browserClient = Object.assign(Object.create(BrowserWebSocketClient.prototype), {
      _auth: auth,
      _logger: logger,
      _sessionVersion: auth.sessionVersion,
      _sessionId: 'test-session',
      _staleSessionIds: new Set(),
      coordinator: { isPrimary: true, notify() {} },
      socketClient: primarySocket
    });
    const acks = [];
    const primary = Object.assign(Object.create(ChannelCoordinator.prototype), {
      id: 'primary',
      _isPrimary: true,
      logger,
      callbacks: {
        onMessage: (message, deadline) =>
          BrowserWebSocketClient.prototype.handleMessage.call(browserClient, message, deadline)
      },
      channel: { postMessage: (envelope) => acks.push(envelope) }
    });
    primary.handleRequest(posted[0].message, posted[0]);
    await flush();
    assert.deepEqual(forwarded, [], 'a primary resuming after expiry must not forward the request');
    assert.match(acks[0].message.payload.error.message, /timeout/);

    // Expiry guards billable sends only: a late control message still applies.
    primarySocket.socket = null;
    primarySocket._authenticatedSocket = null;
    primary.handleRequest({ type: 'request', payload: { type: 'connect' } }, posted[0]);
    await flush();
    assert.equal(connects, 1, 'a late connect request still reaches the primary socket');
    assert.equal(acks[1].message.payload.error, undefined);

    // A primary can also suspend AFTER starting its readiness wait. Advance
    // wall time without running overdue timers, then deliver authentication.
    const client = new WebSocketClient('http://127.0.0.1', auth, 'suspension-test', 'fast', logger);
    const writes = [];
    client.socket = { readyState: 1, send: (data) => writes.push(data) };
    client._openedAt = Date.now();
    const waiting = client.send('jobRequest', { jobID: 'EXPIRED' });
    const expired = assert.rejects(waiting, /connection timeout/);
    mock.timers.setTime(Date.now() + 31_000);
    client._authenticatedSocket = client.socket;
    client.emit('authenticated', { clientType: 'artist', activeProjects: [] });
    await expired;
    assert.deepEqual(writes, [], 'authentication after suspension cannot send expired work');
  } finally {
    mock.timers.reset();
  }
}

async function checkDisposedPrimaryHandoff() {
  const server = new WebSocketServer({ port: 0 });
  const requests = [];
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
      const message = JSON.parse(raw.toString());
      if (message.type === 'jobRequest')
        requests.push(JSON.parse(Buffer.from(message.data, 'base64').toString()));
    });
  });
  const clients = [];
  try {
    const url = `http://127.0.0.1:${server.address().port}`;
    const primaryAuth = new CookieAuthManager(logger);
    const followerAuth = new CookieAuthManager(logger);
    await primaryAuth.authenticate();
    await followerAuth.authenticate();
    const primary = new BrowserWebSocketClient(url, primaryAuth, 'dispose-test', 'fast', logger);
    clients.push(primary);
    await primary.coordinator.isReady();
    const follower = new BrowserWebSocketClient(url, followerAuth, 'dispose-test', 'fast', logger);
    clients.push(follower);
    await follower.coordinator.isReady();
    assert.equal(primary.coordinator.isPrimary, true);
    const api = {
      _auth: primaryAuth,
      _socket: primary,
      _clearReconnect() {},
      removeAllListeners() {}
    };
    ApiClient.prototype.dispose.call(api);
    ApiClient.prototype.dispose.call(api);
    await sleep(650);
    await follower.send('jobRequest', { jobID: 'AFTER-DISPOSE' });
    await sleep(30);
    assert.equal(
      primary.coordinator.isPrimary,
      false,
      'disposed primary relinquishes channel ownership'
    );
    assert.equal(
      primary.socketClient.isConnected,
      false,
      'peer requests never reconnect the disposed client'
    );
    assert.equal(
      primaryAuth.isAuthenticated,
      false,
      'peer auth updates never revive disposed credentials'
    );
    assert.equal(follower.coordinator.isPrimary, true);
    assert.deepEqual(requests, [{ jobID: 'AFTER-DISPOSE' }]);
  } finally {
    for (const client of clients) {
      if (client.dispose) client.dispose();
      else {
        client.socketClient.disconnect();
        clearInterval(client.coordinator.heartbeatTimer);
        clearInterval(client.coordinator.primaryCheckTimer);
        client.coordinator._isPrimary = false;
        client.coordinator.channel.close();
      }
    }
    for (const socket of server.clients) socket.terminate();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function main() {
  const previousWindow = global.window;
  const unloadListeners = new Set();
  let coordinator;
  try {
    global.window = {
      addEventListener(type, listener) {
        if (type === 'beforeunload') unloadListeners.add(listener);
      },
      removeEventListener(type, listener) {
        if (type === 'beforeunload') unloadListeners.delete(listener);
      }
    };
    coordinator = new ChannelCoordinator({
      callbacks: {
        onRoleChange() {},
        onMessage: async () => {},
        onNotification() {}
      },
      logger
    });
    assert.equal(unloadListeners.size, 1);
    coordinator.dispose();
    coordinator.dispose();
    assert.equal(unloadListeners.size, 0, 'disposed coordinators release the window listener');
  } finally {
    coordinator?.dispose();
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
  }
  await checkSlowReconnect();
  await checkMissingAckAndSuspension();
  await checkDisposedPrimaryHandoff();
  console.log('check-browser-request-handoff: ALL TESTS PASSED');
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
