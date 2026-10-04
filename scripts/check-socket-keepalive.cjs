/**
 * Regression test for the Node keep-alive ping.
 *
 * The ping timer starts as soon as the socket is created. ws throws from
 * ping() while the handshake is still in progress, and a throw inside a timer
 * is an uncaught exception that ends the host process, so a reconnect whose
 * handshake outlasted the ping interval used to crash any long-running Node
 * SDK user.
 *
 * Uses a real ws socket held in CONNECTING by a local TCP server that accepts
 * the connection and never answers the upgrade, against compiled `dist/`.
 */

'use strict';

const assert = require('node:assert/strict');
const net = require('node:net');
const WebSocket = require('ws');

// Load the package entry first: requiring the socket module on its own trips
// the ApiClient <-> BrowserWebSocketClient import cycle.
require('../dist/index.js');
const WebSocketClient = require('../dist/ApiClient/WebSocketClient/index.js').default;

// Capture the ping timer's callback instead of waiting PING_INTERVAL.
function startPingAndCaptureTick(client, socket) {
  const realSetInterval = global.setInterval;
  let tick = null;
  global.setInterval = (fn, ms) => {
    tick = fn;
    return realSetInterval(() => {}, ms);
  };
  try {
    client.startPing(socket);
  } finally {
    global.setInterval = realSetInterval;
  }
  assert.equal(typeof tick, 'function', 'startPing scheduled a ping timer');
  return tick;
}

async function main() {
  const sockets = new Set();
  const server = net.createServer((conn) => sockets.add(conn));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  const client = Object.create(WebSocketClient.prototype);
  client._pingInterval = null;
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  socket.on('error', () => {});
  try {
    assert.equal(socket.readyState, WebSocket.CONNECTING);
    assert.throws(() => socket.ping(), /readyState 0 \(CONNECTING\)/, 'premise: ws throws when pinging a connecting socket');

    const tick = startPingAndCaptureTick(client, socket);
    assert.doesNotThrow(tick, 'a ping tick during the handshake does not throw');

    // An open socket is still pinged.
    let pings = 0;
    const openSocket = { readyState: WebSocket.OPEN, ping: () => (pings += 1) };
    client.stopPing();
    startPingAndCaptureTick(client, openSocket)();
    assert.equal(pings, 1, 'an open socket is pinged');

    // A closing or closed socket is left alone.
    for (const readyState of [WebSocket.CLOSING, WebSocket.CLOSED]) {
      client.stopPing();
      startPingAndCaptureTick(client, { readyState, ping: () => (pings += 1) })();
    }
    assert.equal(pings, 1, 'closing and closed sockets are not pinged');
  } finally {
    client.stopPing();
    socket.terminate();
    for (const conn of sockets) conn.destroy();
    await new Promise((resolve) => server.close(resolve));
  }
  console.log('socket keep-alive checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
