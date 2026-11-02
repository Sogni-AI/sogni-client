/**
 * Checks the request `sogni.account.login()` sends and the error it throws when
 * the account was deleted and signing in can restore it. Runs against compiled
 * output, through the real RestClient, so it checks the exact bytes on the wire
 * and the published root exports. A small consumer fixture is type-checked
 * against the package to cover the published declarations.
 */

'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const ts = require('typescript');

const sdk = require('../dist/index.js');
const AccountApi = require('../dist/Account/index.js').default;
const RestClient = require('../dist/lib/RestClient.js').default;

const { ApiError, ACCOUNT_RESTORABLE_ERROR_CODE } = sdk;

// The documented restore flow compiles against the published declarations.
const program = ts.createProgram([path.join(__dirname, 'fixtures/account-login.ts')], {
  strict: true,
  noEmit: true,
  skipLibCheck: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.Node16,
  moduleResolution: ts.ModuleResolutionKind.Node16
});
const diagnostics = ts.getPreEmitDiagnostics(program);
assert.equal(
  diagnostics.length,
  0,
  ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCurrentDirectory: () => process.cwd(),
    getCanonicalFileName: (name) => name,
    getNewLine: () => '\n'
  })
);

const API = 'https://api.example.test';
const USERNAME = 'restore-check';
const PASSWORD = 'correct horse battery staple';
const SIGNATURE = '0xsigned';
const DELETED_AT = 1761955200;
const RESTORABLE = {
  status: 'error',
  errorCode: 196,
  message: 'This account was deleted. Sign in at app.sogni.ai to restore it.',
  details: { deletedAt: DELETED_AT }
};
const LOGGED_IN = {
  status: 'success',
  data: { token: 'token-1', refreshToken: 'refresh-1', username: USERNAME }
};

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function createAccountApi(appSource) {
  const logger = { info() {}, warn() {}, error() {}, debug() {} };
  // A plain auth stub: login() then skips the token/cookie session hand-off,
  // which is not what this check is about.
  const auth = Object.assign(new EventEmitter(), {
    isAuthenticated: false,
    sessionVersion: 0,
    clear() {},
    async authenticateRequest(init) {
      return init;
    }
  });
  const socket = Object.assign(new EventEmitter(), { isConnected: false, supernetType: 'fast' });
  const rest = new RestClient(API, auth, logger);
  const client = Object.assign(new EventEmitter(), { auth, socket, rest, logger, appSource });
  const eip712 = {
    async signTypedData() {
      return SIGNATURE;
    }
  };
  return new AccountApi({ client, eip712 });
}

/** Runs one login call against a stubbed fetch and returns the login request it sent. */
async function runLogin(loginResponse, call) {
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const { pathname } = new URL(url);
    requests.push({ pathname, method: init.method, body: init.body });
    if (pathname === '/v1/account/nonce') {
      return jsonResponse(200, { status: 'success', data: { nonce: 'nonce-1' } });
    }
    if (pathname === '/v1/account/login') return loginResponse();
    throw new Error(`unexpected request to ${pathname}`);
  };
  try {
    const outcome = await call().then(
      (value) => ({ value }),
      (error) => ({ error })
    );
    const logins = requests.filter((request) => request.pathname === '/v1/account/login');
    assert.equal(logins.length, 1, 'login() sends exactly one login request');
    assert.equal(logins[0].method, 'POST');
    return { ...outcome, body: logins[0].body };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function main() {
  const account = createAccountApi('sdk-test');
  const walletAddress = account.getWallet(USERNAME, PASSWORD).address;
  const success = () => jsonResponse(200, LOGGED_IN);

  // Existing call shapes send the same bytes as before the option existed.
  const legacyBody =
    `{"walletAddress":"${walletAddress}","signature":"${SIGNATURE}",` +
    '"appSource":"sdk-test","rememberMe":false}';
  let result = await runLogin(success, () => account.login(USERNAME, PASSWORD));
  assert.equal(result.error, undefined);
  assert.deepEqual(result.value, LOGGED_IN.data);
  assert.equal(result.body, legacyBody, 'two-argument login() body is unchanged');

  result = await runLogin(success, () => account.login(USERNAME, PASSWORD, true, 'web-app'));
  assert.equal(
    result.body,
    `{"walletAddress":"${walletAddress}","signature":"${SIGNATURE}",` +
      '"appSource":"web-app","rememberMe":true}',
    'four-argument login() body is unchanged'
  );

  const noAppSource = createAccountApi(undefined);
  result = await runLogin(success, () => noAppSource.login(USERNAME, PASSWORD));
  assert.equal(
    result.body,
    `{"walletAddress":"${walletAddress}","signature":"${SIGNATURE}","rememberMe":false}`,
    'login() without an appSource still omits it'
  );

  // The flag is sent only when it is set.
  for (const options of [undefined, {}, { restoreDeletedAccount: false }]) {
    result = await runLogin(success, () =>
      account.login(USERNAME, PASSWORD, false, undefined, options)
    );
    assert.equal(result.body, legacyBody, `options ${JSON.stringify(options)} add nothing`);
  }

  result = await runLogin(success, () =>
    account.login(USERNAME, PASSWORD, false, undefined, { restoreDeletedAccount: true })
  );
  assert.equal(result.error, undefined);
  assert.deepEqual(result.value, LOGGED_IN.data, 'a restoring login signs in as usual');
  assert.equal(
    result.body,
    `{"walletAddress":"${walletAddress}","signature":"${SIGNATURE}",` +
      '"appSource":"sdk-test","rememberMe":false,"restoreDeletedAccount":true}',
    'restoreDeletedAccount: true is sent after the existing fields'
  );

  // A deleted account that can be restored: code 196 with details.deletedAt.
  assert.equal(ACCOUNT_RESTORABLE_ERROR_CODE, 196, 'the code is exported from the package root');
  result = await runLogin(
    () => jsonResponse(400, RESTORABLE),
    () => account.login(USERNAME, PASSWORD)
  );
  const { error } = result;
  assert.ok(error instanceof ApiError, 'login() throws ApiError');
  assert.equal(error.status, 400);
  assert.equal(error.payload.errorCode, ACCOUNT_RESTORABLE_ERROR_CODE);
  assert.equal(error.message, RESTORABLE.message, 'the server message is passed through');
  assert.deepEqual(error.details, { deletedAt: DELETED_AT });
  assert.equal(error.details.deletedAt, DELETED_AT, 'deletedAt is readable on the thrown error');
  assert.equal(error.payload.details.deletedAt, DELETED_AT, 'and on its payload');
  assert.equal(new Date(error.details.deletedAt * 1000).toISOString(), '2025-11-01T00:00:00.000Z');

  console.log('account login checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
