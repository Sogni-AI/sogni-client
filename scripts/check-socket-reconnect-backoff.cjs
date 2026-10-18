/**
 * Regression test for the socket reconnect backoff.
 *
 * The backoff must grow while the server keeps closing connections it never
 * authenticates (admission closed during a deploy, an overloaded host) and
 * reset only once a connection is authenticated. It used to reset as soon as a
 * connection opened, so a server that accepts and then closes was retried about
 * once a second indefinitely.
 */
const assert = require('node:assert/strict');
const ApiClient = require('../dist/ApiClient/index.js').default;

const logger = { info() {}, warn() {}, error() {}, debug() {} };

function makeClient() {
  const client = Object.create(ApiClient.prototype);
  Object.assign(client, {
    _disposed: false,
    _disableSocket: false,
    _reconnectAttempt: 0,
    _reconnectTimer: null,
    _onlineListener: null,
    _auth: { isAuthenticated: true },
    _socket: { supernetType: 'fast', connect: async () => {} },
    logger,
    emit() {}
  });
  return client;
}

const client = makeClient();
const opened = { network: 'fast' };
const dropped = { code: 1001, reason: 'Server is restarting' };
try {
  for (let cycle = 1; cycle <= 5; cycle += 1) {
    client.handleSocketDisconnect(dropped);
    assert.equal(client._reconnectAttempt, cycle, `attempt ${cycle} was scheduled`);
    // The server accepts the connection, then closes it before authenticating.
    client.handleSocketConnect(opened);
    assert.equal(client._reconnectAttempt, cycle, 'an unauthenticated open keeps the backoff');
  }
  client.handleSocketAuthenticated();
  assert.equal(client._reconnectAttempt, 0, 'an authenticated connection resets the backoff');
  client.handleSocketDisconnect(dropped);
  assert.equal(client._reconnectAttempt, 1, 'the next drop starts from the base delay again');
} finally {
  client._clearReconnect();
}

console.log('socket reconnect backoff checks passed');
