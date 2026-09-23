/** Regression checks for sign-in ownership across asynchronous authentication and REST work. */
'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
// Load the entry point first to initialize the SDK's circular module dependencies.
const { SogniClient } = require('../dist/index.js');
const TokenAuthManager = require('../dist/lib/AuthManager/TokenAuthManager.js').default;
const CookieAuthManager = require('../dist/lib/AuthManager/CookieAuthManager.js').default;
const ApiKeyAuthManager = require('../dist/lib/AuthManager/ApiKeyAuthManager.js').default;
const RestClient = require('../dist/lib/RestClient.js').default;
const AccountApi = require('../dist/Account/index.js').default;
const CurrentAccount = require('../dist/Account/CurrentAccount.js').default;
const { captureRequestSession } = require('../dist/lib/requestSession.js');

const LOGGER = { debug() {}, info() {}, warn() {}, error() {} };
const BASE_URL = 'https://auth.example.test';
const ACCOUNT_A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const ACCOUNT_B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const SESSION_CHANGED = /account changed/i;
const tick = () => new Promise((resolve) => setImmediate(resolve));

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

// These unsigned fixtures are decoded locally; no test sends them to a real service.
function jwt(payload) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode(payload)}.test`;
}

function tokens(address, serial, expired = false) {
  const now = Math.floor(Date.now() / 1000);
  return {
    token: jwt({ addr: address, env: 'test', iat: now, exp: now + (expired ? -60 : 3600), serial }),
    refreshToken: jwt({ type: 'refresh', env: 'test', iat: now, exp: now + 86400, serial })
  };
}

function response(data, status = 200) {
  return new Response(JSON.stringify({ status: status === 200 ? 'success' : 'error', data }), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function meData(address) {
  return {
    walletAddress: address,
    username: address === ACCOUNT_A ? 'account-a' : 'account-b',
    currentEmail: ''
  };
}

function accountFixture(auth, get) {
  const socket = Object.assign(new EventEmitter(), { isConnected: false, supernetType: 'fast' });
  const client = Object.assign(new EventEmitter(), { auth, socket, rest: { get }, logger: LOGGER });
  return new AccountApi({ client, eip712: {} });
}

function checkAuthFixture(auth, get) {
  return {
    apiClient: { auth, rest: { get }, logger: LOGGER },
    currentAccount: new CurrentAccount()
  };
}

async function main() {
  const originalFetch = global.fetch;
  const unhandled = [];
  const onUnhandled = (error) => {
    unhandled.push(error);
  };
  process.on('unhandledRejection', onUnhandled);
  let passed = 0;
  let failed = 0;

  async function check(name, run) {
    global.fetch = async () => {
      throw new Error('Unexpected network request in auth-session test');
    };
    const previousUnhandled = unhandled.length;
    try {
      await run();
      // Include promises launched by auth-event listeners and their cleanup callbacks.
      await tick();
      await tick();
      assert.deepEqual(unhandled.slice(previousUnhandled), [], 'no unhandled auth-event rejection');
      passed += 1;
      console.log(`PASS ${name}`);
    } catch (error) {
      failed += 1;
      console.error(`FAIL ${name}`, error);
    }
  }

  try {
    await check(
      'API-key rotation and sign-out invalidate requests, repeated authentication does not',
      async () => {
        const auth = new ApiKeyAuthManager(LOGGER);
        assert.equal(auth.sessionVersion, 0);
        await auth.authenticate('test-key-a');
        const first = auth.sessionVersion;
        assert.ok(first > 0);
        const original = captureRequestSession(auth);
        await auth.authenticate('test-key-a');
        assert.equal(auth.sessionVersion, first);
        original();
        await auth.authenticate('test-key-b');
        assert.throws(original, SESSION_CHANGED);
        const beforeLogout = captureRequestSession(auth);
        const second = auth.sessionVersion;
        auth.clear();
        await auth.authenticate('test-key-b');
        assert.ok(auth.sessionVersion > second);
        assert.throws(beforeLogout, SESSION_CHANGED);
        assert.equal(await auth.backup(), 'test-key-b');
      }
    );

    await check(
      'first cookie account lookup preserves a session and establishes its identity',
      async () => {
        const auth = new CookieAuthManager(LOGGER);
        await auth.authenticate();
        const session = auth.sessionVersion;
        const original = captureRequestSession(auth);
        const account = accountFixture(auth, async () => ({ data: meData(ACCOUNT_A) }));
        await account.me();
        assert.equal(account.currentAccount.walletAddress, ACCOUNT_A);
        assert.equal(auth.sessionVersion, session);
        original();
        auth._setSessionIdentity(ACCOUNT_B);
        assert.throws(original, SESSION_CHANGED);
      }
    );

    await check(
      'cookie sign-out and same-account sign-in invalidate the prior session',
      async () => {
        const auth = new CookieAuthManager(LOGGER);
        auth._setSessionIdentity(ACCOUNT_A);
        await auth.authenticate();
        const original = captureRequestSession(auth);
        const session = auth.sessionVersion;
        await auth.authenticate();
        assert.equal(auth.sessionVersion, session);
        original();
        auth.clear();
        auth._setSessionIdentity(ACCOUNT_A);
        await auth.authenticate();
        assert.throws(original, SESSION_CHANGED);
        assert.ok(auth.isAuthenticated);
      }
    );

    await check(
      'initial expired-token authentication and same-account renewal both succeed',
      async () => {
        const auth = new TokenAuthManager(BASE_URL, LOGGER);
        const issued = [
          tokens(ACCOUNT_A, 'initial-renewal'),
          tokens(ACCOUNT_A.toUpperCase(), 'renewed-again')
        ];
        let calls = 0;
        global.fetch = async (url) => {
          assert.equal(new URL(url).pathname, '/v1/account/refresh-token');
          return response(issued[calls++]);
        };
        await auth.authenticate(tokens(ACCOUNT_A, 'expired-initial', true));
        assert.ok(auth.isAuthenticated);
        assert.equal((await auth.backup()).token, issued[0].token);
        const session = auth.sessionVersion;
        const original = captureRequestSession(auth);
        await auth.authenticate(tokens(ACCOUNT_A, 'expired-again', true));
        assert.equal(calls, 2);
        assert.equal(auth.sessionVersion, session);
        assert.equal((await auth.authenticateRequest({})).headers.Authorization, issued[1].token);
        original();
      }
    );

    for (const status of [200, 401]) {
      await check(
        `stale token renewal HTTP ${status} cannot replace or clear a newer login`,
        async () => {
          const auth = new TokenAuthManager(BASE_URL, LOGGER);
          await auth.authenticate(tokens(ACCOUNT_A, 'a-initial'));
          const pending = deferred();
          global.fetch = async () => pending.promise;
          const renewal = auth.authenticate(tokens(ACCOUNT_A, 'a-expired', true));
          const rejected = assert.rejects(renewal, SESSION_CHANGED);
          const next = tokens(ACCOUNT_B, 'b-login');
          await auth.authenticate(next);
          pending.resolve(response(tokens(ACCOUNT_A, 'a-late'), status));
          await rejected;
          assert.ok(auth.isAuthenticated);
          assert.equal((await auth.backup()).token, next.token);
        }
      );
    }

    await check(
      'a new account renewal does not reuse the old account renewal promise',
      async () => {
        const auth = new TokenAuthManager(BASE_URL, LOGGER);
        await auth.authenticate(tokens(ACCOUNT_A, 'a-initial'));
        const pendingA = deferred();
        const pendingB = deferred();
        let calls = 0;
        global.fetch = async () => (++calls === 1 ? pendingA.promise : pendingB.promise);
        const first = auth.authenticate(tokens(ACCOUNT_A, 'a-expired', true));
        const rejected = assert.rejects(first, SESSION_CHANGED);
        const second = auth.authenticate(tokens(ACCOUNT_B, 'b-expired', true));
        assert.equal(calls, 2);
        const next = tokens(ACCOUNT_B, 'b-renewal');
        pendingB.resolve(response(next));
        await second;
        pendingA.resolve(response(tokens(ACCOUNT_A, 'a-late')));
        await rejected;
        assert.equal((await auth.backup()).token, next.token);
      }
    );

    await check(
      'requests started during a different-account renewal wait for the new credentials',
      async () => {
        const auth = new TokenAuthManager(BASE_URL, LOGGER);
        await auth.authenticate(tokens(ACCOUNT_A, 'a-initial'));
        const pending = deferred();
        global.fetch = async () => pending.promise;
        const renewal = auth.authenticate(tokens(ACCOUNT_B, 'b-expired', true));
        let readyBeforeRenewal = false;
        const request = auth.authenticateRequest({}).then((options) => {
          readyBeforeRenewal = true;
          return options;
        });
        await tick();
        const returnedOldCredentials = readyBeforeRenewal;
        const next = tokens(ACCOUNT_B, 'b-renewal');
        pending.resolve(response(next));
        await renewal;
        const options = await request;
        assert.equal(returnedOldCredentials, false, 'the new account request waits for renewal');
        assert.equal(options.headers.Authorization, next.token);
      }
    );

    await check(
      'a late REST 401 from the old account cannot sign out the new account',
      async () => {
        const auth = new ApiKeyAuthManager(LOGGER);
        await auth.authenticate('test-key-a');
        const pending = deferred();
        const started = deferred();
        global.fetch = async () => {
          started.resolve();
          return pending.promise;
        };
        const rest = new RestClient(BASE_URL, auth, LOGGER);
        const rejected = assert.rejects(rest.get('/v1/model/options'), SESSION_CHANGED);
        await started.promise;
        await auth.authenticate('test-key-b');
        pending.resolve(response({}, 401));
        await rejected;
        assert.equal(await auth.backup(), 'test-key-b');
        assert.ok(auth.isAuthenticated);
      }
    );

    await check(
      'explicit account.me rejects stale data without overwriting a newer account',
      async () => {
        const auth = new CookieAuthManager(LOGGER);
        auth._setSessionIdentity(ACCOUNT_A);
        await auth.authenticate();
        const pending = deferred();
        let calls = 0;
        const account = accountFixture(auth, async () =>
          ++calls === 1 ? pending.promise : { data: meData(ACCOUNT_B) }
        );
        const rejected = assert.rejects(account.me(), SESSION_CHANGED);
        auth._setSessionIdentity(ACCOUNT_B);
        await auth.authenticate();
        await tick();
        assert.equal(account.currentAccount.walletAddress, ACCOUNT_B);
        pending.resolve({ data: meData(ACCOUNT_A) });
        await rejected;
        assert.equal(account.currentAccount.walletAddress, ACCOUNT_B);
      }
    );

    await check(
      'superseded event-driven account.me refresh is handled without an unhandled rejection',
      async () => {
        const auth = new CookieAuthManager(LOGGER);
        const pending = deferred();
        let calls = 0;
        const account = accountFixture(auth, async () =>
          ++calls === 1 ? pending.promise : { data: meData(ACCOUNT_B) }
        );
        auth._setSessionIdentity(ACCOUNT_A);
        await auth.authenticate();
        auth._setSessionIdentity(ACCOUNT_B);
        await auth.authenticate();
        await tick();
        pending.resolve({ data: meData(ACCOUNT_A) });
        await tick();
        assert.equal(account.currentAccount.walletAddress, ACCOUNT_B);
      }
    );

    await check(
      'account identity clears during a peer account switch but survives a same-session refresh',
      async () => {
        const auth = new CookieAuthManager(LOGGER);
        auth._setSessionIdentity(ACCOUNT_A);
        await auth.authenticate();
        let lookup = Promise.resolve({ data: meData(ACCOUNT_A) });
        const account = accountFixture(auth, () => lookup);
        await account.me();

        const refresh = deferred();
        lookup = refresh.promise;
        await auth.authenticate();
        assert.equal(account.currentAccount.walletAddress, ACCOUNT_A);
        refresh.resolve({ data: meData(ACCOUNT_A) });
        await tick();

        const switched = deferred();
        lookup = switched.promise;
        auth._invalidateSession();
        await auth.authenticate();
        const oldIdentityWasCleared = !account.currentAccount.isAuthenicated;
        switched.resolve({ data: meData(ACCOUNT_B) });
        await tick();
        assert.equal(
          oldIdentityWasCleared,
          true,
          'the pending new session cannot expose account A'
        );
        assert.equal(account.currentAccount.walletAddress, ACCOUNT_B);
      }
    );

    await check(
      'checkAuth records the cookie identity before returning a usable session',
      async () => {
        const auth = new CookieAuthManager(LOGGER);
        const client = checkAuthFixture(auth, async () => ({ data: meData(ACCOUNT_A) }));
        assert.equal(await SogniClient.prototype.checkAuth.call(client), true);
        assert.ok(auth.isAuthenticated);
        assert.equal(client.currentAccount.walletAddress, ACCOUNT_A);
        const original = captureRequestSession(auth);
        auth._setSessionIdentity(ACCOUNT_B);
        assert.throws(original, SESSION_CHANGED);
      }
    );

    await check(
      'checkAuth ignores an old response after a different account signs in',
      async () => {
        const auth = new CookieAuthManager(LOGGER);
        auth._setSessionIdentity(ACCOUNT_A);
        await auth.authenticate();
        const pending = deferred();
        const client = checkAuthFixture(auth, async () => pending.promise);
        const checkAuth = SogniClient.prototype.checkAuth.call(client);
        auth._setSessionIdentity(ACCOUNT_B);
        await auth.authenticate();
        client.currentAccount._update({ walletAddress: ACCOUNT_B });
        pending.resolve({ data: meData(ACCOUNT_A) });
        assert.equal(await checkAuth, false);
        assert.equal(client.currentAccount.walletAddress, ACCOUNT_B);
        assert.ok(auth.isAuthenticated);
      }
    );
  } finally {
    global.fetch = originalFetch;
    process.removeListener('unhandledRejection', onUnhandled);
  }

  console.log(`Auth session checks: ${passed} passed, ${failed} failed.`);
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
