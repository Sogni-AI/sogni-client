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
const {
  MessageDeliveryUncertainError
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
    const sending = secondary.sendMessage({ type: 'socket-send' });
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

    let forwarded = 0;
    const acks = [];
    const primary = Object.assign(Object.create(ChannelCoordinator.prototype), {
      id: 'primary',
      _isPrimary: true,
      logger,
      callbacks: {
        onMessage: async () => {
          forwarded++;
        }
      },
      channel: { postMessage: (envelope) => acks.push(envelope) }
    });
    primary.handleRequest(posted[0].message, posted[0]);
    await flush();
    assert.equal(forwarded, 0, 'a primary resuming after expiry must not forward the request');
    assert.match(acks[0].message.payload.error.message, /timeout/);

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

async function main() {
  await checkSlowReconnect();
  await checkMissingAckAndSuspension();
  console.log('check-browser-request-handoff: ALL TESTS PASSED');
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
