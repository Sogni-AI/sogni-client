'use strict';

// Real local WebSocket + BroadcastChannel, with the actual encryption API.
// No credentials, remote services, or generation requests.
const assert = require('node:assert/strict');
const { WebSocketServer } = require('ws');
require('../dist/index.js');
const BrowserClient =
  require('../dist/ApiClient/WebSocketClient/BrowserWebSocketClient/index.js').default;
const CookieAuth = require('../dist/lib/AuthManager/CookieAuthManager.js').default;
const MediaEncryptionApi = require('../dist/MediaEncryption/index.js').default;
const logger = { info() {}, warn() {}, error() {}, debug() {} };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate) {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'local event must arrive within five seconds');
    await sleep(10);
  }
}

async function main() {
  const server = new WebSocketServer({ port: 0 });
  let available = false;
  let handshakes = 0;
  server.on('connection', (socket) => {
    handshakes++;
    socket.send(
      JSON.stringify({
        type: 'authenticated',
        data: Buffer.from(
          JSON.stringify({
            clientType: 'artist',
            activeProjects: [],
            mediaEncryptionAvailable: available
          })
        ).toString('base64')
      })
    );
  });
  const tabs = [];
  async function addTab() {
    const auth = new CookieAuth(logger);
    auth._setSessionIdentity('account-a');
    await auth.authenticate();
    const socket = new BrowserClient(
      `http://127.0.0.1:${server.address().port}`,
      auth,
      'encryption-replay-local',
      'fast',
      logger,
      undefined,
      { projectQueue: false }
    );
    const media = new MediaEncryptionApi({ client: { auth, socket, logger }, eip712: {} });
    const tab = { auth, socket, media, authenticated: 0, authUpdates: 0, snapshots: [] };
    socket.on('authenticated', () => tab.authenticated++);
    auth.on('updated', () => tab.authUpdates++);
    socket.on('mediaEncryptionAvailabilityUpdated', (data) => tab.snapshots.push(data));
    tabs.push(tab);
    await socket.coordinator.isReady();
    await socket.connect();
    return tab;
  }
  try {
    const primary = await addTab();
    await until(() => primary.authenticated === 1);
    assert.equal(primary.media.available, false);
    available = true; // A rollout switch is not a new authenticated handshake.
    const secondary = await addTab();
    await until(() => secondary.snapshots.length === 1);
    assert.equal(primary.media.available, false);
    assert.equal(secondary.media.available, false);
    assert.equal(handshakes, 1, 'joining does not force a shared reconnect');
    assert.equal(secondary.authenticated, 0, 'snapshot never replays authentication/recovery');
    assert.equal(secondary.authUpdates, 0, 'snapshot never mutates authentication');

    await primary.socket.disconnect();
    await primary.socket.connect();
    await until(() => primary.media.available && secondary.media.available);
    assert.equal(handshakes, 2, 'the new handshake observes the enabled rollout');
    const late = await addTab();
    await until(() => late.snapshots.length === 1);
    assert.equal(late.media.available, true, 'late secondary receives the enabled snapshot');
    assert.equal(late.authenticated, 0);
    assert.equal(late.authUpdates, 0);
    assert.deepEqual(late.snapshots, [true], 'the replay carries only a boolean');

    // Availability changes while connected: the server says so on the open socket,
    // and a tab that joins afterwards is told the current answer, not the handshake's.
    for (const socket of server.clients) {
      socket.send(
        JSON.stringify({
          type: 'mediaEncryptionAvailabilityUpdated',
          data: Buffer.from(JSON.stringify(false)).toString('base64')
        })
      );
    }
    await until(() => tabs.every((tab) => !tab.media.available));
    const later = await addTab();
    await until(() => later.snapshots.length === 1);
    assert.deepEqual(later.snapshots, [false], 'a later tab gets the current availability');
    assert.equal(later.media.available, false);
    assert.equal(handshakes, 2, 'the change needed no new handshake');
    const oldSession = primary.socket._sessionId;

    // Logout must erase the primary snapshot and every tab's availability.
    primary.auth.clear();
    await until(() => tabs.every((tab) => !tab.auth.isAuthenticated && !tab.media.available));
    assert.equal(primary.socket._lastMediaEncryptionAvailable, null);
    await late.socket.handleNotification({
      type: 'socket-event',
      sessionId: oldSession,
      payload: { type: 'mediaEncryptionAvailabilityUpdated', data: true }
    });
    assert.equal(late.media.available, false, 'stale account replay cannot restore availability');

    // Account replacement while authenticated also clears the cached snapshot.
    // Keep this direct check local: no server account response is fabricated.
    primary.auth._setSessionIdentity('account-b');
    await primary.auth.authenticate();
    primary.socket.handleSocketEvent('authenticated', {
      clientType: 'artist',
      activeProjects: [],
      mediaEncryptionAvailable: true
    });
    assert.equal(primary.media.available, true);
    primary.auth._setSessionIdentity('account-c');
    assert.equal(primary.media.available, false);
    assert.equal(primary.socket._lastMediaEncryptionAvailable, null);
    console.log(
      'Browser encryption availability: late false/true, handshake refresh, live availability change replayed, no auth replay, logout and account fencing passed.'
    );
  } finally {
    for (const tab of tabs) tab.socket.dispose();
    for (const socket of server.clients) socket.terminate();
    await new Promise((resolve) => server.close(resolve));
  }
}
// A promise that never settles drains the event loop, which would otherwise exit 0 unseen.
process.exitCode = 1;
main().then(
  () => {
    process.exitCode = 0;
  },
  (error) => {
    console.error(error);
    process.exitCode = 1;
  }
);
