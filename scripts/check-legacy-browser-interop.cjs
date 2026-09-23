/** Exercise an installed, published SDK beside this build using real tab coordination. */
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { WebSocketServer } = require('ws');
require('../dist/index.js');
const CurrentBrowser =
  require('../dist/ApiClient/WebSocketClient/BrowserWebSocketClient/index.js').default;
const CurrentAuth = require('../dist/lib/AuthManager/CookieAuthManager.js').default;
const legacyRoot = process.argv[2];
assert.ok(legacyRoot, 'Pass the directory of an installed @sogni-ai/sogni-client@5.54.1 package');
assert.equal(require(path.join(legacyRoot, 'package.json')).version, '5.54.1');
require(path.join(legacyRoot, 'dist/index.js'));
const LegacyBrowser = require(
  path.join(legacyRoot, 'dist/ApiClient/WebSocketClient/BrowserWebSocketClient/index.js')
).default;
const LegacyAuth = require(
  path.join(legacyRoot, 'dist/lib/AuthManager/CookieAuthManager.js')
).default;
const logger = { debug() {}, info() {}, warn() {}, error() {} };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function close(client) {
  if (client.dispose) return client.dispose();
  client.socketClient.disconnect();
  const coordinator = client.coordinator;
  coordinator._isPrimary = false;
  coordinator.electionInProgress = false;
  clearInterval(coordinator.heartbeatTimer);
  clearInterval(coordinator.primaryCheckTimer);
  coordinator.channel.close();
}

async function check(legacyPrimary) {
  const server = new WebSocketServer({ port: 0 });
  const received = [];
  let connections = 0;
  const wire = (socket, type, data) =>
    socket.send(
      JSON.stringify({
        type,
        data: Buffer.from(JSON.stringify(data)).toString('base64')
      })
    );
  server.on('connection', (socket) => {
    connections++;
    wire(socket, 'authenticated', { clientType: 'artist', activeProjects: [] });
    wire(socket, 'balanceUpdate', { fixture: 'initial-balance' });
    socket.on('message', (raw) => {
      const { type, data } = JSON.parse(raw.toString());
      received.push({ type, ...JSON.parse(Buffer.from(data, 'base64').toString()) });
    });
  });
  const clients = [];
  try {
    const url = `http://127.0.0.1:${server.address().port}`;
    const oldAuth = new LegacyAuth(logger);
    const newAuth = new CurrentAuth(logger);
    await oldAuth.authenticate();
    newAuth._setSessionIdentity('account-a');
    await newAuth.authenticate();
    const create = (old) =>
      new (old ? LegacyBrowser : CurrentBrowser)(
        url,
        old ? oldAuth : newAuth,
        'persistent-browser-installation',
        'fast',
        logger
      );
    const primary = create(legacyPrimary);
    clients.push(primary);
    await primary.coordinator.isReady();
    await primary.connect();
    await primary.send('llmJobRequest', { jobID: 'EXISTING-CHAT' });
    const follower = create(!legacyPrimary);
    clients.push(follower);
    const tokens = [];
    const balances = [];
    follower.on('jobTokens', (data) => tokens.push(data.content));
    follower.on('balanceUpdate', (data) => balances.push(data.fixture));
    await follower.coordinator.isReady();
    await follower.connect();
    assert.equal(
      primary.coordinator.isPrimary,
      true,
      'opening a new version keeps the live primary'
    );
    assert.equal(follower.isConnected, true, 'both versions report usable connection state');
    await follower.send('jobRequest', { jobID: 'FOLLOWER-IMAGE' });
    await follower.send('llmJobRequest', { jobID: 'FOLLOWER-CHAT' });
    for (const socket of server.clients)
      wire(socket, 'jobTokens', { jobID: 'EXISTING-CHAT', content: 'continued' });
    await sleep(35);
    assert.deepEqual(
      received.map((item) => item.jobID),
      ['EXISTING-CHAT', 'FOLLOWER-IMAGE', 'FOLLOWER-CHAT']
    );
    assert.deepEqual(tokens, ['continued'], 'live chat events cross versions');
    assert.ok(balances.includes('initial-balance'), 'late tabs receive the cached balance');
    assert.equal(connections, 1, 'mixed versions never create competing app-id connections');
    await newAuth.authenticate();
    await follower.send('jobRequest', { jobID: 'SAME-ACCOUNT-REFRESH' });
    await sleep(20);
    assert.equal(received.at(-1).jobID, 'SAME-ACCOUNT-REFRESH');

    const beforeChange = received.length;
    newAuth._setSessionIdentity('account-b');
    await newAuth.authenticate();
    await sleep(25);
    await assert.rejects(
      follower.send('jobRequest', { jobID: 'AMBIGUOUS-OLD-SESSION' }),
      /account changed/i
    );
    assert.equal(
      received.length,
      beforeChange,
      'ambiguous legacy work is never forwarded after account change'
    );
    if (legacyPrimary) {
      primary.coordinator.notify({
        type: 'socket-event',
        payload: { type: 'jobTokens', data: { jobID: 'EXISTING-CHAT', content: 'stale' } }
      });
      await sleep(25);
      assert.deepEqual(tokens, ['continued'], 'untagged old-account events stay suppressed');
    }
    console.log(
      `PASS ${legacyPrimary ? '5.54.1 primary/current follower' : 'current primary/5.54.1 follower'}`
    );
  } finally {
    for (const client of clients.reverse()) close(client);
    for (const socket of server.clients) socket.terminate();
    await new Promise((resolve) => server.close(resolve));
  }
}

(async () => {
  await check(true);
  await check(false);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
