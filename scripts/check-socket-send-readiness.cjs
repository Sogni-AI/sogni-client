/**
 * Regression tests for when `WebSocketClient.send` puts a frame on the wire.
 *
 * The socket server drops any frame that arrives before its `authenticated`
 * handshake, and during a socket deploy there is a gap in which connections
 * are refused or accepted and immediately closed with 1001. Work submitted in
 * that window must go out on the next authenticated connection, not fail and
 * not vanish.
 *
 * Runs a real local WebSocket server against compiled `dist/` output.
 */

'use strict';

const assert = require('node:assert/strict');
const { WebSocketServer } = require('ws');

// Load the package entry first: requiring the socket module on its own trips
// the ApiClient <-> BrowserWebSocketClient import cycle.
require('../dist/index.js');
const WebSocketClient = require('../dist/ApiClient/WebSocketClient/index.js').default;
const ApiKeyAuthManager = require('../dist/lib/AuthManager/ApiKeyAuthManager.js').default;
const ApiClient = require('../dist/ApiClient/index.js').default;

const SILENT_LOGGER = { info() {}, warn() {}, error() {}, debug() {} };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const b64 = (obj) => Buffer.from(JSON.stringify(obj), 'utf8').toString('base64');
const frame = (type, data) => JSON.stringify({ type, data: b64(data) });

function makeAuth() {
  return {
    isAuthenticated: true,
    on() {
      return () => {};
    },
    async socketOptions() {
      return undefined;
    }
  };
}

/** A server whose per-connection behaviour the test controls. */
function startServer() {
  const wss = new WebSocketServer({ port: 0 });
  const state = { mode: 'auth', authDelayMs: 0, received: [], connections: 0 };
  wss.on('connection', (ws) => {
    state.connections++;
    ws.on('message', (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.type === 'ping') return;
      state.received.push({
        type: message.type,
        authenticated: ws.authenticated === true,
        data: JSON.parse(Buffer.from(message.data, 'base64').toString('utf8'))
      });
    });
    if (state.mode === 'restarting') {
      ws.close(1001, 'Server is restarting');
      return;
    }
    setTimeout(() => {
      ws.authenticated = true;
      ws.send(frame('authenticated', { clientType: 'artist', activeProjects: [] }));
    }, state.authDelayMs);
  });
  const url = () => `http://127.0.0.1:${wss.address().port}`;
  return { wss, state, url };
}

async function main() {
  // Disposal must finish handshake waits before ApiClient removes their listeners.
  {
    const { wss, state, url } = startServer();
    state.authDelayMs = 150;
    const api = new ApiClient({
      baseUrl: url(),
      socketUrl: url(),
      appId: 'DISPOSE-WAIT',
      authType: 'apiKey',
      disableSocket: true,
      networkType: 'fast',
      logger: SILENT_LOGGER
    });
    await api.auth.authenticate('local-test-key');
    const originalSetInterval = global.setInterval;
    const originalClearInterval = global.clearInterval;
    const intervals = new Set();
    global.setInterval = (...args) => {
      const interval = originalSetInterval(...args);
      intervals.add(interval);
      return interval;
    };
    global.clearInterval = (interval) => {
      intervals.delete(interval);
      originalClearInterval(interval);
    };
    let rejection;
    try {
      const connected = new Promise((resolve) => api.once('connected', resolve));
      rejection = assert.rejects(
        api.socket.send('jobRequest', { jobID: 'DISPOSED' }, Date.now() + 300)
      );
      await connected;
      api.dispose();
      await sleep(20);
      assert.equal(intervals.size, 0, 'dispose clears pending send readiness timers immediately');
      await rejection;
      assert.equal(state.received.length, 0);
    } finally {
      api.dispose();
      if (rejection) await rejection;
      for (const interval of intervals) originalClearInterval(interval);
      global.setInterval = originalSetInterval;
      global.clearInterval = originalClearInterval;
      for (const socket of wss.clients) socket.terminate();
      await new Promise((resolve) => wss.close(resolve));
    }
  }
  // Concurrent first submissions share one connection, including its ping timer.
  {
    const { wss, state, url } = startServer();
    const auth = new ApiKeyAuthManager(SILENT_LOGGER);
    await auth.authenticate('local-test-key');
    const client = new WebSocketClient(url(), auth, 'CONCURRENT', 'fast', SILENT_LOGGER);
    const originalSetInterval = global.setInterval;
    const originalClearInterval = global.clearInterval;
    const intervals = new Set();
    global.setInterval = (...args) => {
      const interval = originalSetInterval(...args);
      intervals.add(interval);
      return interval;
    };
    global.clearInterval = (interval) => {
      intervals.delete(interval);
      originalClearInterval(interval);
    };
    try {
      await Promise.all([
        client.send('jobRequest', { jobID: 'FIRST' }),
        client.send('jobRequest', { jobID: 'SECOND' })
      ]);
      await sleep(30);
      assert.equal(state.connections, 1, 'first sends share a physical connection');
      assert.deepEqual(state.received.map((item) => item.data.jobID).sort(), ['FIRST', 'SECOND']);
      client.disconnect();
      await sleep(30);
      assert.equal(intervals.size, 0, 'disconnect leaves no orphan ping or readiness intervals');
    } finally {
      client.disconnect();
      for (const interval of intervals) originalClearInterval(interval);
      global.setInterval = originalSetInterval;
      global.clearInterval = originalClearInterval;
      for (const socket of wss.clients) socket.terminate();
      await new Promise((resolve) => wss.close(resolve));
    }
  }

  // A cancelled credential wait cannot reopen later or clear a newer connect.
  {
    const { wss, state, url } = startServer();
    const resolvers = [];
    const auth = makeAuth();
    auth.socketOptions = () => new Promise((resolve) => resolvers.push(resolve));
    const client = new WebSocketClient(url(), auth, 'CANCELLED-CONNECT', 'fast', SILENT_LOGGER);
    try {
      const oldConnect = client.connect();
      const oldRejected = assert.rejects(oldConnect, /connection cancelled/);
      client.disconnect();
      const newConnect = client.connect();
      resolvers[0]();
      await oldRejected;
      const sharedNewConnect = client.connect();
      assert.equal(resolvers.length, 2, 'old completion cannot clear the newer credential wait');
      resolvers[1]();
      await Promise.all([newConnect, sharedNewConnect]);
      await client.send('jobRequest', { jobID: 'CURRENT' });
      await sleep(30);
      assert.equal(state.connections, 1);
      assert.deepEqual(
        state.received.map((item) => item.data.jobID),
        ['CURRENT']
      );
    } finally {
      client.disconnect();
      for (const socket of wss.clients) socket.terminate();
      await new Promise((resolve) => wss.close(resolve));
    }
  }

  // 1. A send right after connect waits for `authenticated`; the frame is never
  //    written while the server would still drop it.
  {
    const { wss, state, url } = startServer();
    state.authDelayMs = 150;
    const client = new WebSocketClient(url(), makeAuth(), 'APP-1', 'fast', SILENT_LOGGER);
    await client.connect();
    await client.send('jobRequest', { jobID: 'P1' });
    await sleep(50);
    assert.equal(state.received.length, 1);
    assert.equal(state.received[0].authenticated, true, 'sent only after authentication');
    client.disconnect();
    wss.close();
  }

  // 2. Socket deploy: the connection closes with 1001 and the next attempts are
  //    turned away. A send issued in the gap waits and goes out on the
  //    connection that authenticates, without opening connections of its own.
  {
    const { wss, state, url } = startServer();
    const client = new WebSocketClient(url(), makeAuth(), 'APP-2', 'fast', SILENT_LOGGER);
    await client.connect();
    await new Promise((resolve) => client.once('authenticated', resolve));
    state.mode = 'restarting';
    // Emulate the ApiClient: reconnect after each recoverable close.
    const offReconnect = client.on('disconnected', ({ code }) => {
      if (code === 1001 || code === 1006) setTimeout(() => client.connect(), 40);
    });
    for (const ws of wss.clients) ws.close(1001, 'Server is restarting');
    await sleep(20);
    const connectionsBefore = state.connections;
    const sending = client.send('jobRequest', { jobID: 'P2' });
    await sleep(150);
    assert.equal(state.received.length, 0, 'nothing sent into the gap');
    assert.ok(
      state.connections - connectionsBefore <= 4,
      'send did not add its own connection attempts on top of the reconnect loop'
    );
    state.mode = 'auth';
    await sending;
    await sleep(50);
    assert.deepEqual(
      state.received.map((r) => [r.data.jobID, r.authenticated]),
      [['P2', true]],
      'delivered once, after the restart, on an authenticated connection'
    );
    offReconnect();
    client.disconnect();
    wss.close();
  }

  // 3. A terminal close ends the wait with an error instead of hanging.
  {
    const { wss, state, url } = startServer();
    state.authDelayMs = 10_000;
    const client = new WebSocketClient(url(), makeAuth(), 'APP-3', 'fast', SILENT_LOGGER);
    await client.connect();
    const sending = client.send('jobRequest', { jobID: 'P3' });
    await sleep(80);
    for (const ws of wss.clients) ws.close(4021, 'Authentication error');
    await assert.rejects(sending, /connection failed/);
    assert.equal(state.received.length, 0);
    wss.close();
  }

  console.log('check-socket-send-readiness: ALL TESTS PASSED');
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
