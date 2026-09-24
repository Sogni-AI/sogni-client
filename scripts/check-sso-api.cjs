/**
 * Smoke tests for the SSO SDK surface (ssoLogin / ssoSignup / ssoLink,
 * MeData auth propagation, package exports).
 *
 * Runs against compiled `dist/` output so it also verifies public declaration
 * files and CommonJS imports after a real build.
 */

'use strict';

const assert = require('node:assert/strict');

const AccountApi = require('../dist/Account/index.js').default;
const CurrentAccount = require('../dist/Account/CurrentAccount.js').default;
const { SSO_ERROR_CODES } = require('../dist/Account/types.js');
const rootExports = require('../dist/index.js');

class StubListeners {
  constructor() {
    this._listeners = new Map();
  }

  on(event, handler) {
    const list = this._listeners.get(event) ?? [];
    list.push(handler);
    this._listeners.set(event, list);
  }

  off(event, handler) {
    const list = this._listeners.get(event) ?? [];
    this._listeners.set(
      event,
      list.filter((h) => h !== handler)
    );
  }

  emit(event, data) {
    for (const handler of this._listeners.get(event) ?? []) {
      handler(data);
    }
  }
}

class StubAuth extends StubListeners {
  constructor() {
    super();
    this.isAuthenticated = true;
  }

  async authenticateRequest(init) {
    return init ?? {};
  }

  clear() {
    this.isAuthenticated = false;
  }
}

class StubSocket extends StubListeners {
  get isConnected() {
    return false;
  }

  get supernetType() {
    return 'fast';
  }

  async send() {}
}

function makeStubClient() {
  const auth = new StubAuth();
  const socket = new StubSocket();
  const rest = {
    baseUrl: 'https://api.example.test',
    _lastCall: null,
    _nextPayload: null,
    async get(endpoint, query) {
      this._lastCall = { method: 'GET', endpoint, query, body: null };
      return this._nextPayload;
    },
    async post(endpoint, body) {
      this._lastCall = { method: 'POST', endpoint, query: null, body };
      return this._nextPayload;
    }
  };

  return {
    auth,
    socket,
    rest,
    appId: 'sso-test-appid',
    appSource: 'sdk-test',
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    on() {},
    off() {}
  };
}

function makeApi() {
  const client = makeStubClient();
  const api = new AccountApi({ client, eip712: {} });
  return { api, client };
}

async function run() {
  // ── exports ────────────────────────────────────────────────────────────────
  assert.equal(typeof AccountApi.prototype.ssoLogin, 'function', 'ssoLogin missing');
  assert.equal(typeof AccountApi.prototype.ssoSignup, 'function', 'ssoSignup missing');
  assert.equal(typeof AccountApi.prototype.ssoLink, 'function', 'ssoLink missing');
  assert.deepEqual(rootExports.SSO_ERROR_CODES, SSO_ERROR_CODES, 'SSO_ERROR_CODES not re-exported');
  assert.equal(SSO_ERROR_CODES.SSO_LINK_REQUIRED, 186);
  assert.equal(SSO_ERROR_CODES.SSO_EMAIL_CHANGED, 187);
  assert.equal(SSO_ERROR_CODES.SSO_LINK_EMAIL_MISMATCH, 188);

  // ── ssoLogin: endpoint + payload + appSource default ───────────────────────
  {
    const { api, client } = makeApi();
    client.rest._nextPayload = {
      status: 'success',
      data: { token: 't1', refreshToken: 'r1', username: 'alice' }
    };
    const data = await api.ssoLogin('google', 'ID_TOKEN');
    assert.equal(client.rest._lastCall.endpoint, '/v1/account/sso/login');
    assert.deepEqual(client.rest._lastCall.body, {
      provider: 'google',
      idToken: 'ID_TOKEN',
      appSource: 'sdk-test', // defaulted from client config
      rememberMe: false
    });
    assert.equal(data.username, 'alice');
  }

  // ── ssoLogin: explicit appSource + rememberMe override ────────────────────
  {
    const { api, client } = makeApi();
    client.rest._nextPayload = {
      status: 'success',
      data: { token: 't1', refreshToken: 'r1', username: 'alice' }
    };
    await api.ssoLogin('apple', 'ID_TOKEN', true, 'my-app');
    assert.deepEqual(client.rest._lastCall.body, {
      provider: 'apple',
      idToken: 'ID_TOKEN',
      appSource: 'my-app',
      rememberMe: true
    });
  }

  // ── ssoSignup: appid injection + subscribe coercion ───────────────────────
  {
    const { api, client } = makeApi();
    client.rest._nextPayload = {
      status: 'success',
      data: { token: 't2', refreshToken: 'r2', username: 'newuser' }
    };
    const data = await api.ssoSignup({
      provider: 'google',
      idToken: 'ID_TOKEN',
      username: 'newuser',
      subscribe: true,
      referralCode: 'FRIEND1'
    });
    assert.equal(client.rest._lastCall.endpoint, '/v1/account/sso/signup');
    assert.deepEqual(client.rest._lastCall.body, {
      appid: 'sso-test-appid',
      provider: 'google',
      idToken: 'ID_TOKEN',
      username: 'newuser',
      subscribe: 1,
      appSource: 'sdk-test',
      referralCode: 'FRIEND1',
      rememberMe: false
    });
    assert.equal(data.username, 'newuser');
  }

  // ── ssoSignup + password: derived wallet, nonce, EIP-712 signature, token email ──
  {
    const client = makeStubClient();
    const calls = [];
    client.rest.post = async (endpoint, body) => {
      calls.push({ endpoint, body });
      if (endpoint === '/v1/account/nonce') {
        return { status: 'success', data: { nonce: 'NONCE-1' } };
      }
      return { status: 'success', data: { token: 't3', refreshToken: 'r3', username: 'pwuser' } };
    };
    const signed = [];
    const api = new AccountApi({
      client,
      eip712: {
        async signTypedData(wallet, type, value) {
          signed.push({ address: wallet.address, type, value });
          return '0xSIGNED';
        }
      }
    });
    const payload = Buffer.from(JSON.stringify({ sub: 'g-1', email: 'Person@Example.com' }))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const idToken = `eyJhbGciOiJSUzI1NiJ9.${payload}.sig`;
    const expectedAddress = api.getWallet('pwuser', 'correct horse battery').address;

    const data = await api.ssoSignup(
      { provider: 'google', idToken, username: 'pwuser', password: 'correct horse battery' },
      true
    );
    assert.equal(data.username, 'pwuser');
    assert.deepEqual(
      calls.map((c) => c.endpoint),
      ['/v1/account/nonce', '/v1/account/sso/signup'],
      'nonce must be fetched for the derived wallet before signup'
    );
    assert.deepEqual(calls[0].body, { walletAddress: expectedAddress });
    assert.deepEqual(signed, [
      {
        address: expectedAddress,
        type: 'signup',
        value: {
          appid: 'sso-test-appid',
          username: 'pwuser',
          email: 'Person@Example.com',
          subscribe: 0,
          walletAddress: expectedAddress,
          nonce: 'NONCE-1'
        }
      }
    ]);
    assert.deepEqual(calls[1].body, {
      appid: 'sso-test-appid',
      provider: 'google',
      idToken,
      username: 'pwuser',
      subscribe: 0,
      appSource: 'sdk-test',
      referralCode: undefined,
      rememberMe: true,
      email: 'Person@Example.com',
      walletAddress: expectedAddress,
      signature: '0xSIGNED'
    });

    // Without a password nothing about the wire format changes.
    calls.length = 0;
    await api.ssoSignup({ provider: 'google', idToken, username: 'pwuser' });
    assert.deepEqual(calls.map((c) => c.endpoint), ['/v1/account/sso/signup']);
    assert.equal('walletAddress' in calls[0].body, false);
    assert.equal('signature' in calls[0].body, false);

    // A token without an email claim cannot set a password — fail before any call.
    calls.length = 0;
    const noEmail = `eyJhbGciOiJSUzI1NiJ9.${Buffer.from('{"sub":"a-1"}').toString('base64url')}.sig`;
    await assert.rejects(
      api.ssoSignup({ provider: 'apple', idToken: noEmail, username: 'pwuser', password: 'x'.repeat(8) }),
      /no email address/
    );
    assert.equal(calls.length, 0);

    const { readIdTokenEmail } = require('../dist/Account/index.js');
    assert.equal(readIdTokenEmail(idToken), 'Person@Example.com');
    assert.equal(readIdTokenEmail('not-a-jwt'), undefined);
    assert.equal(readIdTokenEmail(noEmail), undefined);
  }

  // ── ssoLink: endpoint + currentAccount.authMethods update ─────────────────
  {
    const { api, client } = makeApi();
    client.rest._nextPayload = {
      status: 'success',
      data: { provider: 'google', authMethods: ['password', 'sso-google'] }
    };
    const data = await api.ssoLink('google', 'ID_TOKEN');
    assert.equal(client.rest._lastCall.endpoint, '/v1/account/sso/link');
    assert.deepEqual(client.rest._lastCall.body, { provider: 'google', idToken: 'ID_TOKEN' });
    assert.deepEqual(data.authMethods, ['password', 'sso-google']);
    assert.deepEqual(api.currentAccount.authMethods, ['password', 'sso-google']);
  }

  // ── me(): auth/authMethods propagation + legacy default ───────────────────
  {
    const { api, client } = makeApi();
    client.rest._nextPayload = {
      status: 'success',
      data: {
        username: 'bob',
        currentEmail: 'bob@example.com',
        walletAddress: '0xB0B',
        auth: 'sso-apple',
        authMethods: ['password', 'sso-apple']
      }
    };
    await api.me();
    assert.equal(api.currentAccount.auth, 'sso-apple');
    assert.equal(api.currentAccount.isSsoSession, true);
    assert.deepEqual(api.currentAccount.authMethods, ['password', 'sso-apple']);
  }
  {
    // Older API server: no auth fields → grade defaults to password.
    const { api, client } = makeApi();
    client.rest._nextPayload = {
      status: 'success',
      data: { username: 'bob', currentEmail: 'b@e.com', walletAddress: '0xB0B' }
    };
    await api.me();
    assert.equal(api.currentAccount.auth, 'password');
    assert.equal(api.currentAccount.isSsoSession, false);
    assert.equal(api.currentAccount.authMethods, undefined);
  }

  // ── CurrentAccount defaults + clear ───────────────────────────────────────
  {
    const acct = new CurrentAccount();
    assert.equal(acct.auth, undefined);
    assert.equal(acct.isSsoSession, false);
    assert.equal(acct.authMethods, undefined);
  }

  console.log('check-sso-api: all assertions passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
