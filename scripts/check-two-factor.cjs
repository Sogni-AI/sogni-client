'use strict';
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const ts = require('typescript');
const { Wallet, parseEther, verifyTypedData } = require('ethers');
const { ApiError, TwoFactorRequiredError } = require('../dist/index.js');
const AccountApi = require('../dist/Account/index.js').default;
const RestClient = require('../dist/lib/RestClient.js').default;
const TokenAuthManager = require('../dist/lib/AuthManager/TokenAuthManager.js').default;
const CookieAuthManager = require('../dist/lib/AuthManager/CookieAuthManager.js').default;

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function checkWithdrawDeclarations() {
  const program = ts.createProgram([path.join(__dirname, 'fixtures/withdraw-two-factor.ts')], {
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
}

async function check(Auth) {
  const sessions = [];
  const requests = [];
  const auth = Object.assign(Object.create(Auth.prototype), {
    on() {}, _setSessionIdentity(value) { sessions.push(value); },
    async authenticate(value) { sessions.push(value ?? 'cookie'); }
  });
  let fail = false;
  const client = Object.assign(new EventEmitter(), {
    auth, logger: { info() {}, warn() {}, error() {}, debug() {} },
    socket: Object.assign(new EventEmitter(), { isConnected: false }),
    rest: { async post(path, body) {
      requests.push({ path, body });
      if (path === '/v1/account/login') return { data: {
        requires2FA: true, tempToken: 'pending', username: 'artist', token: '', refreshToken: ''
      } };
      if (path === '/v1/account/2fa/verify-login') {
        if (fail) throw new Error('Invalid code');
        return { data: { token: 'access', refreshToken: 'refresh' } };
      }
      throw new Error(`Unexpected endpoint ${path}`);
    } }
  });
  const account = new AccountApi({ client, eip712: { async signTypedData() { return 'signature'; } } });
  account.getWallet = () => ({ address: '0xABCD' });
  account.getNonce = async () => 'nonce';
  let challenge;
  await assert.rejects(account.login('artist', 'password', true), error => {
    assert(error instanceof TwoFactorRequiredError);
    challenge = error;
    return true;
  });
  assert.deepEqual(sessions, [], 'pending sign-in cannot create a session');
  assert.equal(requests[0].body.rememberMe, true);
  fail = true;
  await assert.rejects(account.verifyTwoFactorLogin(challenge, '123456'));
  assert.deepEqual(sessions, [], 'rejected code cannot create a session');
  const proof = { challengeId: 'challenge', assertion: { id: 'key' } };
  await assert.rejects(account.verifyTwoFactorLogin(challenge, proof));
  assert.deepEqual(sessions, [], 'rejected passkey cannot create a session');
  fail = false;
  const result = await account.verifyTwoFactorLogin(challenge, ' abcdef12 ');
  assert.deepEqual(requests.at(-1).body, { tempToken: 'pending', code: 'ABCDEF12' });
  assert.deepEqual(result, { token: 'access', refreshToken: 'refresh', username: 'artist' });
  assert.deepEqual(sessions, Auth === TokenAuthManager
    ? [{ token: 'access', refreshToken: 'refresh' }] : ['0xabcd', 'cookie']);
  sessions.length = 0;
  await account.verifyTwoFactorLogin(challenge, proof);
  assert.deepEqual(requests.at(-1).body, { tempToken: 'pending', ...proof });
  assert.equal(sessions.length, Auth === TokenAuthManager ? 1 : 2);
}

async function runWithdraw(options) {
  const { amount = '10', provider = 'base', proof, withdrawResponse } = options;
  const hasProofArg = Object.hasOwn(options, 'proof');
  const wallet = Wallet.createRandom();
  const logger = { info() {}, warn() {}, error() {}, debug() {} };
  let authCleared = false;
  const auth = Object.assign(new EventEmitter(), {
    isAuthenticated: true,
    sessionVersion: 1,
    clear() { authCleared = true; },
    async authenticateRequest(init) { return init; }
  });
  const socket = Object.assign(new EventEmitter(), { isConnected: false, supernetType: 'fast' });
  const rest = new RestClient('https://api.example.test', auth, logger);
  const client = Object.assign(new EventEmitter(), { auth, socket, rest, logger });
  const account = new AccountApi({ client, eip712: {}, testnet: false });
  account.currentAccount._update({ username: 'artist', walletAddress: wallet.address });
  account.getWallet = () => wallet;

  const permitData = {
    domain: {
      name: 'Sogni AI',
      version: '1',
      chainId: provider === 'etherlink' ? '42793' : '8453',
      verifyingContract: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC'
    },
    types: {
      WithdrawTokenV2: [
        { name: 'walletAddress', type: 'address' },
        { name: 'amount', type: 'string' },
        { name: 'provider', type: 'string' },
        { name: 'nonce', type: 'string' }
      ]
    }
  };

  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const { pathname } = new URL(url);
    const body = JSON.parse(init.body);
    requests.push({ pathname, method: init.method, body, rawBody: init.body });
    if (pathname === '/v1/account/token/withdraw/permit') {
      return jsonResponse(200, {
        status: 'success',
        data: { ...permitData, message: { ...body, nonce: 'nonce-1' } }
      });
    }
    if (pathname === '/v2/account/token/withdraw') {
      return withdrawResponse
        ? withdrawResponse()
        : jsonResponse(200, { status: 'success', data: {} });
    }
    throw new Error(`Unexpected endpoint ${pathname}`);
  };

  try {
    const outcome = await (hasProofArg
      ? account.withdraw('secret-password', amount, provider, proof)
      : account.withdraw('secret-password', amount, provider)
    ).then(
      () => ({ error: undefined }),
      (error) => ({ error })
    );
    return { ...outcome, requests, wallet, permitData, authCleared };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function checkWithdrawStepUp() {
  const expectedAmountWei = parseEther('10').toString();

  // 1. Omitting proof (and passing undefined) omits `proof` from the POST payload.
  for (const args of [{ amount: '10', provider: 'base' }, { amount: '10', provider: 'base', proof: undefined }]) {
    const res = await runWithdraw(args);
    assert.equal(res.error, undefined);
    assert.equal(res.requests.length, 2);
    assert.equal(res.requests[0].pathname, '/v1/account/token/withdraw/permit');
    assert.equal(Object.hasOwn(res.requests[0].body, 'proof'), false);
    const withdrawReq = res.requests[1];
    assert.equal(withdrawReq.pathname, '/v2/account/token/withdraw');
    assert.equal(withdrawReq.method, 'POST');
    assert.equal(Object.hasOwn(withdrawReq.body, 'proof'), false, 'omitted proof must not appear in POST body');
    assert.deepEqual(Object.keys(withdrawReq.body).sort(), ['amount', 'provider', 'signature', 'walletAddress']);
    assert.equal(withdrawReq.body.walletAddress, res.wallet.address);
    assert.equal(withdrawReq.body.amount, expectedAmountWei);
    assert.equal(withdrawReq.body.provider, 'base');
    assert.equal(
      verifyTypedData(
        res.permitData.domain,
        res.permitData.types,
        { walletAddress: res.wallet.address, amount: expectedAmountWei, provider: 'base', nonce: 'nonce-1' },
        withdrawReq.body.signature
      ),
      res.wallet.address
    );
  }

  // 2. Supplying an authenticator/backup code proof sends `{ ...payload, signature, proof: { code } }`.
  {
    const proof = { code: '123456' };
    const res = await runWithdraw({ amount: '10', provider: 'base', proof });
    assert.equal(res.error, undefined);
    assert.equal(res.requests.length, 2);
    assert.equal(Object.hasOwn(res.requests[0].body, 'proof'), false, 'permit request does not carry proof');
    const withdrawReq = res.requests[1];
    assert.equal(withdrawReq.pathname, '/v2/account/token/withdraw');
    assert.deepEqual(withdrawReq.body, {
      walletAddress: res.wallet.address,
      amount: expectedAmountWei,
      provider: 'base',
      signature: withdrawReq.body.signature,
      proof: { code: '123456' }
    });
  }

  // 3. Supplying a passkey proof sends `{ ...payload, signature, proof: { challengeId, assertion } }`.
  {
    const assertion = {
      id: 'cred-1',
      rawId: 'cred-1',
      type: 'public-key',
      response: {
        clientDataJSON: 'eyJ0eXBlIjoid2ViYXV0aG4uZ2V0In0',
        authenticatorData: 'SZYN5YgOjGh0NBcPZHZgW4_krrmihjLHmVzzuoMdl2MFAAAAAQ',
        signature: 'MEUCIQDf'
      },
      clientExtensionResults: {}
    };
    const proof = { challengeId: '0123456789abcdef0123456789abcdef', assertion };
    const res = await runWithdraw({ amount: '10', provider: 'etherlink', proof });
    assert.equal(res.error, undefined);
    assert.equal(res.requests.length, 2);
    assert.equal(Object.hasOwn(res.requests[0].body, 'proof'), false, 'permit request does not carry proof');
    const withdrawReq = res.requests[1];
    assert.equal(withdrawReq.pathname, '/v2/account/token/withdraw');
    assert.deepEqual(withdrawReq.body, {
      walletAddress: res.wallet.address,
      amount: expectedAmountWei,
      provider: 'etherlink',
      signature: withdrawReq.body.signature,
      proof: { challengeId: '0123456789abcdef0123456789abcdef', assertion }
    });
  }

  // 4. 403 / 211 TWO_FACTOR_REQUIRED refusal surfaces ApiError with errorCode 211 and details.
  for (const details of [
    { authenticator: true, passkeys: true },
    { authenticator: false, passkeys: true },
    { authenticator: true, passkeys: false }
  ]) {
    const message =
      'Enter a code from your authenticator app or a backup code, or use your passkey, to withdraw tokens.';
    const res = await runWithdraw({
      amount: '10',
      provider: 'base',
      withdrawResponse: () =>
        jsonResponse(403, {
          status: 'error',
          errorCode: 211,
          message,
          details
        })
    });
    assert.ok(res.error instanceof ApiError, '403 / 211 refusal must throw ApiError');
    assert.equal(res.error.status, 403);
    assert.equal(res.error.payload.errorCode, 211);
    assert.equal(res.error.message, message);
    assert.deepEqual(res.error.details, details);
    assert.deepEqual(res.error.payload.details, details);
    assert.equal(res.authCleared, false, '403 step-up refusal must not clear auth session');
  }
}

Promise.all([check(TokenAuthManager), check(CookieAuthManager)])
  .then(() => checkWithdrawStepUp())
  .then(() => {
    checkWithdrawDeclarations();
    console.log('Two-factor sign-in and withdraw step-up checks passed.');
  })
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
