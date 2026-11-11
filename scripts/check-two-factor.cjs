'use strict';
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { TwoFactorRequiredError } = require('../dist/index.js');
const AccountApi = require('../dist/Account/index.js').default;
const TokenAuthManager = require('../dist/lib/AuthManager/TokenAuthManager.js').default;
const CookieAuthManager = require('../dist/lib/AuthManager/CookieAuthManager.js').default;

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

Promise.all([check(TokenAuthManager), check(CookieAuthManager)]).then(() => {
  console.log('Two-factor sign-in: token and cookie session checks passed.');
}).catch(error => { console.error(error); process.exitCode = 1; });
