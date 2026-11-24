'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const AccountApi = require('../dist/Account/index.js').default;
const ApiClient = require('../dist/ApiClient/index.js').default;

function makeApi() {
  const socket = Object.assign(new EventEmitter(), {
    isConnected: false,
    supernetType: 'fast'
  });
  const auth = Object.assign(new EventEmitter(), {
    sessionVersion: 1,
    isAuthenticated: true
  });
  const client = Object.assign(new EventEmitter(), {
    socket,
    auth,
    rest: { get: async () => client.nextResponse },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    _clearReconnect() {},
    _disposed: false
  });
  // Use the real connection forwarding methods, registered before Account
  // just as in ApiClient's constructor. No connection or HTTP call is made.
  socket.on('connected', ApiClient.prototype.handleSocketConnect.bind(client));
  socket.on('authenticated', ApiClient.prototype.handleSocketAuthenticated.bind(client));
  const api = new AccountApi({ client, eip712: {} });
  const connect = () => {
    socket.isConnected = true;
    socket.emit('connected', { network: 'fast' });
  };
  const entitlement = (available, version = 3) => ({
    active: true,
    subscription: {
      status: 'active',
      tier: 'unlimited',
      term: 'monthly',
      version: String(version),
      periodStart: Date.now() - 1000,
      periodEnd: Date.now() + 3600000,
      capabilities: { unlimited: true, ...(available ? { priorityMode: true } : {}) }
    }
  });
  const authenticate = (available = true, version = 3) => {
    socket.emit('authenticated', {
      subscriptionEntitlement: entitlement(available, version)
    });
  };
  const push = (available, version = 3) => {
    socket.emit('subscriptionEntitlementUpdated', entitlement(available, version));
  };
  const refresh = async (available = true, version = 3, extra = {}) => {
    client.nextResponse = {
      data: {
        subscription: {
          active: true,
          status: 'active',
          tier: 'unlimited',
          version,
          capabilities: { anotherFeature: true, ...(available ? { priorityMode: true } : {}) },
          ...extra
        }
      }
    };
    return api.getSubscriptionStatus();
  };
  return { api, client, auth, socket, connect, authenticate, push, refresh };
}

async function main() {
  {
    const { api, client } = makeApi();
    const ordinary = { active: true, status: 'active', tier: 'unlimited' };
    client.nextResponse = { data: { subscription: ordinary } };
    assert.deepEqual(await api.getSubscriptionStatus(), ordinary);
    assert.deepEqual(api.currentAccount.subscription, ordinary);
  }
  {
    const { api, connect, authenticate, refresh } = makeApi();
    connect();
    // REST cannot offer Priority before the current connection has a verdict.
    assert.equal((await refresh()).capabilities.priorityMode, undefined);
    authenticate(false);
    const result = await refresh();
    assert.equal(result.capabilities.priorityMode, undefined);
    assert.equal(result.capabilities.anotherFeature, true);
    assert.deepEqual(result, api.currentAccount.subscription);
  }
  {
    const { api, connect, authenticate, push, refresh } = makeApi();
    connect();
    authenticate(true);
    assert.equal(api.currentAccount.subscription.capabilities.priorityMode, true);
    assert.equal((await refresh(false)).capabilities.priorityMode, true);
    assert.equal((await refresh(false)).capabilities.anotherFeature, true);
    // An older accepted-transport candidate cannot replace the current verdict.
    push(false, 2);
    assert.equal((await refresh()).capabilities.priorityMode, true);
    push(false, 4);
    assert.equal((await refresh(true, 4)).capabilities.priorityMode, undefined);
  }
  {
    const { api, client, socket, connect, authenticate, refresh } = makeApi();
    connect();
    authenticate();
    socket.isConnected = false;
    client.emit('connecting', { network: 'fast' });
    assert.equal(api.currentAccount.subscription.capabilities.priorityMode, undefined);
    assert.equal((await refresh()).capabilities.priorityMode, undefined);
    connect();
    assert.equal((await refresh()).capabilities.priorityMode, undefined);
    authenticate();
    assert.equal(api.currentAccount.subscription.capabilities.priorityMode, true);
    socket.isConnected = false;
    client.emit('disconnected');
    assert.equal((await refresh()).capabilities.priorityMode, undefined);
  }
  {
    const { api, auth, connect, authenticate, refresh } = makeApi();
    connect();
    authenticate();
    // The auth epoch also excludes a verdict when no connection event arrived.
    auth.sessionVersion += 1;
    assert.equal((await refresh()).capabilities.priorityMode, undefined);
    auth.emit('sessionChanged');
    assert.equal(api.currentAccount.subscription, undefined);
    assert.equal((await refresh()).capabilities.priorityMode, undefined);
    authenticate();
    assert.equal(api.currentAccount.subscription.capabilities.priorityMode, true);
    auth.emit('updated', false);
    assert.equal(api.currentAccount.subscription, undefined);
    assert.equal((await refresh()).capabilities.priorityMode, undefined);
  }
  {
    const { connect, authenticate, refresh } = makeApi();
    connect();
    authenticate();
    assert.equal(
      (await refresh(true, 3, { active: false, status: 'expired' })).capabilities.priorityMode,
      undefined
    );
    assert.equal(
      (await refresh(true, 3, { status: 'trialing' })).capabilities.priorityMode,
      undefined
    );
  }
  console.log('Priority capability connection, refresh and account-scope checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
