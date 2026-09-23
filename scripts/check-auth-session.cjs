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
const ApiClient = require('../dist/ApiClient/index.js').default;
const AccountApi = require('../dist/Account/index.js').default;
const CurrentAccount = require('../dist/Account/CurrentAccount.js').default;
const ProjectsApi = require('../dist/Projects/index.js').default;
const { captureRequestSession } = require('../dist/lib/requestSession.js');
const BrowserWebSocketClient =
  require('../dist/ApiClient/WebSocketClient/BrowserWebSocketClient/index.js').default;

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

    await check('a delayed balance response body cannot refill the next account', async () => {
      const auth = new ApiKeyAuthManager(LOGGER);
      await auth.authenticate('test-key-a');
      const body = deferred();
      const readingBody = deferred();
      global.fetch = async (url) =>
        String(url).includes('/balance')
          ? {
              status: 200,
              ok: true,
              text: () => {
                readingBody.resolve();
                return body.promise;
              }
            }
          : response(meData(ACCOUNT_B));
      const rest = new RestClient(BASE_URL, auth, LOGGER);
      const account = accountFixture(auth, rest.get.bind(rest));
      const result = account.refreshBalance();
      const rejected = assert.rejects(result, SESSION_CHANGED);
      await readingBody.promise;
      await auth.authenticate('test-key-b');
      await tick();
      body.resolve(JSON.stringify({ data: { spark: { settled: 'old-balance' } } }));
      await rejected;
      assert.equal(account.currentAccount.walletAddress, ACCOUNT_B);
      assert.notEqual(account.currentAccount.balance.spark?.settled, 'old-balance');
    });

    await check(
      'a delayed 401 body cannot clear credentials signed in after its headers',
      async () => {
        const auth = new ApiKeyAuthManager(LOGGER);
        await auth.authenticate('test-key-a');
        const body = deferred();
        const readingBody = deferred();
        global.fetch = async () => ({
          status: 401,
          ok: false,
          headers: new Headers(),
          text: () => {
            readingBody.resolve();
            return body.promise;
          }
        });
        const rest = new RestClient(BASE_URL, auth, LOGGER);
        const rejected = assert.rejects(rest.get('/v1/account/me'), SESSION_CHANGED);
        await readingBody.promise;
        assert.equal(auth.isAuthenticated, false);
        await auth.authenticate('test-key-b');
        body.resolve(JSON.stringify({ status: 'error', message: 'Unauthorized' }));
        await rejected;
        assert.equal(await auth.backup(), 'test-key-b');
      }
    );

    await check('a delayed logout 401 cannot sign out a newer account', async () => {
      const auth = new ApiKeyAuthManager(LOGGER);
      await auth.authenticate('test-key-a');
      const body = deferred();
      const readingBody = deferred();
      global.fetch = async (url) =>
        String(url).includes('/logout')
          ? {
              status: 401,
              ok: false,
              headers: new Headers(),
              text: () => {
                readingBody.resolve();
                return body.promise;
              }
            }
          : response(meData(ACCOUNT_B));
      const rest = new RestClient(BASE_URL, auth, LOGGER);
      const account = accountFixture(auth, rest.get.bind(rest));
      account.client.rest.post = rest.post.bind(rest);
      const rejected = assert.rejects(account.logout(), SESSION_CHANGED);
      await readingBody.promise;
      assert.equal(auth.isAuthenticated, false);
      await auth.authenticate('test-key-b');
      body.resolve(JSON.stringify({ status: 'error', message: 'Unauthorized' }));
      await rejected;
      assert.equal(await auth.backup(), 'test-key-b');
    });

    await check('ordinary logout 401 remains successful and REST keeps its status', async () => {
      const auth = new ApiKeyAuthManager(LOGGER);
      await auth.authenticate('test-key-a');
      global.fetch = async () => response({}, 401);
      const rest = new RestClient(BASE_URL, auth, LOGGER);
      const account = accountFixture(auth, rest.get.bind(rest));
      account.client.rest.post = rest.post.bind(rest);
      await account.logout();
      assert.equal(auth.isAuthenticated, false);
      await assert.rejects(rest.get('/v1/account/me'), (error) => error.status === 401);
    });

    await check('same-session token renewal does not discard a response body', async () => {
      const auth = new TokenAuthManager(BASE_URL, LOGGER);
      await auth.authenticate(tokens(ACCOUNT_A, 'before-body'));
      const body = deferred();
      const readingBody = deferred();
      global.fetch = async () => ({
        status: 200,
        ok: true,
        text: () => {
          readingBody.resolve();
          return body.promise;
        }
      });
      const rest = new RestClient(BASE_URL, auth, LOGGER);
      const result = rest.get('/v1/account/me');
      await readingBody.promise;
      await auth.authenticate(tokens(ACCOUNT_A, 'after-body'));
      body.resolve(JSON.stringify({ data: meData(ACCOUNT_A) }));
      assert.equal((await result).data.walletAddress, ACCOUNT_A);
    });

    await check(
      'disposing during token renewal cannot restore credentials or open a socket',
      async () => {
        const api = new ApiClient({
          baseUrl: BASE_URL,
          socketUrl: BASE_URL,
          appId: 'dispose-session-test',
          authType: 'token',
          disableSocket: true,
          networkType: 'fast',
          logger: LOGGER
        });
        await api.auth.authenticate(tokens(ACCOUNT_A, 'before-dispose'));
        // Let the current access token expire while its refresh token remains valid.
        api.auth._tokenExpiresAt = new Date(0);
        const renewal = deferred();
        const started = deferred();
        global.fetch = async () => {
          started.resolve();
          return renewal.promise;
        };
        const connecting = api.socket.connect();
        const rejected = assert.rejects(connecting, SESSION_CHANGED);
        await started.promise;
        api.dispose();
        renewal.resolve(response(tokens(ACCOUNT_A, 'after-dispose')));
        await rejected;
        assert.equal(api.auth.isAuthenticated, false);
        assert.equal(await api.auth.backup(), null);
        assert.equal(api.socket.isConnected, false);
      }
    );

    await check('disposing clears account state and pending project reconciliation', async () => {
      const api = new ApiClient({
        baseUrl: BASE_URL,
        socketUrl: BASE_URL,
        appId: 'dispose-project-test',
        authType: 'apiKey',
        disableSocket: true,
        networkType: 'fast',
        logger: LOGGER
      });
      const account = new AccountApi({ client: api, eip712: {} });
      const projects = new ProjectsApi({ client: api, eip712: {} });
      let fetches = 0;
      global.fetch = async () => {
        fetches += 1;
        return response(meData(ACCOUNT_A));
      };
      try {
        await api.auth.authenticate('test-key-a');
        await tick();
        assert.equal(account.currentAccount.walletAddress, ACCOUNT_A);
        account.currentAccount._update({ email: 'account-a@example.test' });
        projects._scheduleRecheck(0);
        projects.handleServerConnected();
        const beforeDispose = fetches;
        api.dispose();
        const disposedSession = api.auth.sessionVersion;
        api.dispose();
        assert.equal(api.auth.sessionVersion, disposedSession, 'disposal is idempotent');
        assert.equal(account.currentAccount.walletAddress, undefined);
        assert.equal(account.currentAccount.email, undefined);
        assert.equal(projects._recheckTimer, null);
        assert.equal(projects._authenticatedTimer, null);
        await new Promise((resolve) => setTimeout(resolve, 300));
        assert.equal(fetches, beforeDispose, 'disposed project timers issue no requests');
      } finally {
        clearTimeout(projects._recheckTimer);
        clearTimeout(projects._authenticatedTimer);
        api.dispose();
      }
    });

    await check('a reconnect rejected after disposal cannot schedule another timer', async () => {
      const api = new ApiClient({
        baseUrl: BASE_URL,
        socketUrl: BASE_URL,
        appId: 'dispose-reconnect-test',
        authType: 'token',
        disableSocket: true,
        networkType: 'fast',
        logger: LOGGER
      });
      await api.auth.authenticate(tokens(ACCOUNT_A, 'before-reconnect'));
      api.auth._tokenExpiresAt = new Date(0);
      const renewal = deferred();
      const started = deferred();
      global.fetch = async () => {
        started.resolve();
        return renewal.promise;
      };
      try {
        api._disableSocket = false;
        api._scheduleReconnect();
        await started.promise;
        api.dispose();
        renewal.resolve(response(tokens(ACCOUNT_A, 'after-dispose')));
        await tick();
        await tick();
        assert.equal(api._reconnectTimer, null);
        assert.equal(api.auth.isAuthenticated, false);
        assert.equal(api.socket.isConnected, false);
      } finally {
        api._clearReconnect();
        api.dispose();
      }
    });

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

    await check(
      'initial cookie discovery does not retry across a peer account replacement',
      async () => {
        const auth = new CookieAuthManager(LOGGER);
        const pending = deferred();
        let calls = 0;
        const client = checkAuthFixture(auth, async () => {
          calls++;
          return pending.promise;
        });
        const checking = SogniClient.prototype.checkAuth.call(client);
        auth._invalidateSession();
        auth._setSessionIdentity(ACCOUNT_B);
        await auth.authenticate();
        client.currentAccount._update({ walletAddress: ACCOUNT_B });
        pending.resolve({ data: meData(ACCOUNT_A) });
        assert.equal(await checking, false);
        assert.equal(calls, 1);
        assert.equal(client.currentAccount.walletAddress, ACCOUNT_B);
      }
    );

    await check('cold cookie tabs both finish their initial account check', async () => {
      const clients = [];
      try {
        const authA = new CookieAuthManager(LOGGER);
        const authB = new CookieAuthManager(LOGGER);
        clients.push(
          new BrowserWebSocketClient(BASE_URL, authA, 'cold-session-test', 'fast', LOGGER)
        );
        await clients[0].coordinator.isReady();
        clients.push(
          new BrowserWebSocketClient(BASE_URL, authB, 'cold-session-test', 'fast', LOGGER)
        );
        await clients[1].coordinator.isReady();
        const pending = deferred();
        const started = deferred();
        let callsB = 0;
        global.fetch = async (url) => {
          if (String(url).includes('tab-b') && ++callsB === 1) {
            started.resolve();
            return pending.promise;
          }
          return response(meData(ACCOUNT_A));
        };
        const restA = new RestClient('https://tab-a.example.test', authA, LOGGER);
        const restB = new RestClient('https://tab-b.example.test', authB, LOGGER);
        const clientA = checkAuthFixture(authA, restA.get.bind(restA));
        const clientB = checkAuthFixture(authB, restB.get.bind(restB));
        const firstB = SogniClient.prototype.checkAuth.call(clientB);
        await started.promise;
        const peerAuthenticated = new Promise((resolve) => authB.once('updated', resolve));
        assert.equal(await SogniClient.prototype.checkAuth.call(clientA), true);
        await peerAuthenticated;
        pending.resolve(response(meData(ACCOUNT_A)));
        assert.equal(await firstB, true);
        assert.equal(clientB.currentAccount.walletAddress, ACCOUNT_A);
        assert.equal(callsB, 2, 'the joined session is checked again before applying an identity');
      } finally {
        for (const client of clients) {
          clearInterval(client.coordinator.heartbeatTimer);
          clearInterval(client.coordinator.primaryCheckTimer);
          client.coordinator.channel.close();
          client.socketClient.disconnect();
        }
      }
    });
    await check(
      'peer logout invalidates a cold tab account lookup without restoring either tab',
      async () => {
        const authA = new CookieAuthManager(LOGGER);
        authA._setSessionIdentity(ACCOUNT_A);
        await authA.authenticate();
        const authB = new CookieAuthManager(LOGGER);
        const clients = [];
        try {
          clients.push(new BrowserWebSocketClient(BASE_URL, authA, 'cold-logout', 'fast', LOGGER));
          await clients[0].coordinator.isReady();
          clients.push(new BrowserWebSocketClient(BASE_URL, authB, 'cold-logout', 'fast', LOGGER));
          await clients[1].coordinator.isReady();
          const body = deferred();
          const readingBody = deferred();
          global.fetch = async () => ({
            status: 200,
            ok: true,
            text: () => {
              readingBody.resolve();
              return body.promise;
            }
          });
          const rest = new RestClient(BASE_URL, authB, LOGGER);
          const clientB = checkAuthFixture(authB, rest.get.bind(rest));
          const checking = SogniClient.prototype.checkAuth.call(clientB);
          await readingBody.promise;
          const receivedLogout = new Promise((resolve) => {
            clients[1].coordinator.channel.addEventListener('message', (event) => {
              const message = event.data.message;
              if (
                message.type === 'broadcast' &&
                message.payload.type === 'auth-state-changed' &&
                message.payload.payload === false
              )
                resolve();
            });
          });
          authA.clear();
          await receivedLogout;
          body.resolve(JSON.stringify({ data: meData(ACCOUNT_A) }));
          assert.equal(await checking, false);
          await tick();
          assert.equal(authA.isAuthenticated, false);
          assert.equal(authB.isAuthenticated, false);
          assert.equal(clientB.currentAccount.walletAddress, undefined);
        } finally {
          for (const client of clients) client.dispose();
        }
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
