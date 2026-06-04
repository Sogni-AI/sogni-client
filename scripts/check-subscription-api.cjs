/**
 * Unit tests for the subscription API surface added in this branch.
 *
 * Verifies:
 *   - AccountApi methods call the correct endpoints with the right HTTP
 *     method and body.
 *   - Responses are unwrapped from the `{ status, data }` envelope.
 *   - getSubscriptionStatus() propagates the snapshot to currentAccount.
 *   - CurrentAccount.subscription accessor and isUnlimited getter behave
 *     correctly across the full status/tier matrix.
 *   - _clear() resets subscription to undefined.
 *   - refreshSubscription() is a convenience alias that also updates
 *     currentAccount.
 *
 * Runs against the compiled dist/ output so it doubles as a build-smoke
 * test for the subscription types being present at the public export.
 */

'use strict';

const assert = require('node:assert/strict');

// ─── Load compiled artefacts ─────────────────────────────────────────────────

const AccountApi   = require('../dist/Account/index.js').default;
const CurrentAccount = require('../dist/Account/CurrentAccount.js').default;

// ─── Stub infrastructure ─────────────────────────────────────────────────────

class StubAuth {
  constructor() { this.isAuthenticated = true; }
  async authenticateRequest(init) { return init ?? {}; }
  clear() { this.isAuthenticated = false; }
  on()  {}
  off() {}
}

class StubSocket {
  get isConnected() { return false; }
  get supernetType() { return 'fast'; }
  on()  {}
  off() {}
}

function makeStubClient() {
  const auth   = new StubAuth();
  const socket = new StubSocket();

  // Minimal RestClient stub: captures last call, resolves with `_nextPayload`.
  const rest = {
    baseUrl: 'https://api.example.test',
    _lastCall: null,
    _nextPayload: null,
    async get(path, _query) {
      this._lastCall = { method: 'GET', path, body: null };
      return this._nextPayload;
    },
    async post(path, body) {
      this._lastCall = { method: 'POST', path, body };
      return this._nextPayload;
    }
  };

  const client = {
    auth,
    socket,
    rest,
    on()  {},
    off() {}
  };

  return client;
}

const STUB_EIP712 = {};

function makeApi() {
  const client = makeStubClient();
  const config = { client, eip712: STUB_EIP712 };
  const api = new AccountApi(config);
  return { api, client };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function apiResponse(data) {
  return { status: 'success', data };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

async function run() {

  // ── 1. getSubscriptionStatus ──────────────────────────────────────────────

  {
    const { api, client } = makeApi();
    const snapshot = {
      active: true,
      status: 'active',
      tier: 'unlimited',
      planId: 'unlimited_monthly',
      provider: 'stripe',
      currentPeriodStart: 1700000000,
      currentPeriodEnd:   1702678400,
      cancelAtPeriodEnd: false
    };
    client.rest._nextPayload = apiResponse(snapshot);

    const result = await api.getSubscriptionStatus();

    assert.equal(
      client.rest._lastCall.path,
      '/v1/subscriptions/status',
      'getSubscriptionStatus() must GET /v1/subscriptions/status'
    );
    assert.equal(client.rest._lastCall.method, 'GET');
    assert.deepEqual(result, snapshot, 'getSubscriptionStatus() must return unwrapped snapshot');

    // Snapshot propagates to currentAccount
    assert.deepEqual(
      api.currentAccount.subscription,
      snapshot,
      'getSubscriptionStatus() must update currentAccount.subscription'
    );

    // isUnlimited gate
    assert.equal(
      api.currentAccount.isUnlimited,
      true,
      'isUnlimited must be true for active unlimited subscription'
    );
  }

  // ── 2. getSubscriptionPlans ───────────────────────────────────────────────

  {
    const { api, client } = makeApi();
    const plans = [
      {
        planId: 'unlimited_monthly',
        name: 'Unlimited Monthly',
        term: 'monthly',
        currency: 'usd',
        price: 999,
        displayPrice: '$9.99/mo',
        tier: 'unlimited',
        trialAvailable: true,
        trialDays: 7,
        features: ['Unlimited images', 'Unlimited videos']
      }
    ];
    client.rest._nextPayload = apiResponse(plans);

    const result = await api.getSubscriptionPlans();

    assert.equal(
      client.rest._lastCall.path,
      '/v1/subscriptions/plans',
      'getSubscriptionPlans() must GET /v1/subscriptions/plans'
    );
    assert.equal(client.rest._lastCall.method, 'GET');
    assert.deepEqual(result, plans, 'getSubscriptionPlans() must return unwrapped plan array');
    assert.equal(result.length, 1);
    assert.equal(result[0].planId, 'unlimited_monthly');
  }

  // ── 3. getSubscriptionUsage ───────────────────────────────────────────────

  {
    const { api, client } = makeApi();
    const usage = {
      imagesGenerated: 42,
      videosGenerated: 7,
      tokensUsed: 18500,
      periodStart: 1700000000,
      periodEnd:   1702678400
    };
    client.rest._nextPayload = apiResponse(usage);

    const result = await api.getSubscriptionUsage();

    assert.equal(
      client.rest._lastCall.path,
      '/v1/subscriptions/usage',
      'getSubscriptionUsage() must GET /v1/subscriptions/usage'
    );
    assert.equal(client.rest._lastCall.method, 'GET');
    assert.deepEqual(result, usage, 'getSubscriptionUsage() must return unwrapped usage object');
  }

  // ── 4. createSubscriptionCheckout ────────────────────────────────────────

  {
    const { api, client } = makeApi();
    client.rest._nextPayload = apiResponse({ url: 'https://checkout.stripe.com/pay/cs_test_abc123' });

    const result = await api.createSubscriptionCheckout('unlimited_monthly', 'monthly');

    assert.equal(
      client.rest._lastCall.path,
      '/v1/iap/stripe/subscribe',
      'createSubscriptionCheckout() must POST /v1/iap/stripe/subscribe'
    );
    assert.equal(client.rest._lastCall.method, 'POST');
    assert.deepEqual(
      client.rest._lastCall.body,
      { planId: 'unlimited_monthly', term: 'monthly' },
      'createSubscriptionCheckout() must send planId + term in body'
    );
    assert.equal(result.url, 'https://checkout.stripe.com/pay/cs_test_abc123');

    // annual term
    client.rest._nextPayload = apiResponse({ url: 'https://checkout.stripe.com/pay/cs_test_annual' });
    await api.createSubscriptionCheckout('unlimited_annual', 'annual');
    assert.deepEqual(
      client.rest._lastCall.body,
      { planId: 'unlimited_annual', term: 'annual' }
    );
  }

  // ── 5. createSubscriptionPortalSession ───────────────────────────────────

  {
    const { api, client } = makeApi();
    client.rest._nextPayload = apiResponse({ url: 'https://billing.stripe.com/session/bps_test_xyz' });

    const result = await api.createSubscriptionPortalSession();

    assert.equal(
      client.rest._lastCall.path,
      '/v1/subscriptions/stripe/portal',
      'createSubscriptionPortalSession() must POST /v1/subscriptions/stripe/portal'
    );
    assert.equal(client.rest._lastCall.method, 'POST');
    assert.equal(result.url, 'https://billing.stripe.com/session/bps_test_xyz');
  }

  // ── 6. refreshSubscription (alias) ───────────────────────────────────────

  {
    const { api, client } = makeApi();
    const snapshot = { active: true, status: 'trialing', tier: 'unlimited', planId: 'unlimited_monthly' };
    client.rest._nextPayload = apiResponse(snapshot);

    const result = await api.refreshSubscription();

    assert.equal(
      client.rest._lastCall.path,
      '/v1/subscriptions/status',
      'refreshSubscription() must delegate to /v1/subscriptions/status'
    );
    assert.deepEqual(result, snapshot);
    assert.deepEqual(api.currentAccount.subscription, snapshot);
  }

  // ── 7. CurrentAccount.isUnlimited — status/tier matrix ───────────────────

  {
    // No snapshot yet
    const ca = new CurrentAccount();
    assert.equal(ca.subscription, undefined,  'subscription should start undefined');
    assert.equal(ca.isUnlimited,  false,       'isUnlimited should be false when no snapshot');

    // active=false
    ca._update({ subscription: { active: false } });
    assert.equal(ca.isUnlimited, false, 'isUnlimited must be false when active=false');

    // active=true but status=past_due
    ca._update({ subscription: { active: true, status: 'past_due', tier: 'unlimited' } });
    assert.equal(ca.isUnlimited, false, 'isUnlimited must be false for past_due');

    // active=true, status=active, tier not unlimited
    ca._update({ subscription: { active: true, status: 'active', tier: 'free' } });
    assert.equal(ca.isUnlimited, false, 'isUnlimited must be false for non-unlimited tier');

    // active=true, status=active, tier=unlimited
    ca._update({ subscription: { active: true, status: 'active', tier: 'unlimited' } });
    assert.equal(ca.isUnlimited, true, 'isUnlimited must be true for active unlimited');

    // active=true, status=trialing, tier=unlimited
    ca._update({ subscription: { active: true, status: 'trialing', tier: 'unlimited' } });
    assert.equal(ca.isUnlimited, true, 'isUnlimited must be true for trialing unlimited');

    // _clear() resets subscription
    ca._clear();
    assert.equal(ca.subscription, undefined, '_clear() must reset subscription to undefined');
    assert.equal(ca.isUnlimited,  false,     '_clear() must reset isUnlimited to false');
  }

  // ── 8. CurrentAccount subscription emits 'updated' ───────────────────────

  {
    const ca = new CurrentAccount();
    const updatedKeys = [];
    const off = ca.on('updated', (keys) => updatedKeys.push(...keys));

    ca._update({ subscription: { active: true, status: 'active', tier: 'unlimited' } });
    assert.ok(updatedKeys.includes('subscription'), "updated event must include 'subscription' key");

    off();
  }

  // ── 9. Existing balance API is unchanged ─────────────────────────────────

  {
    // balance field still present on defaults
    const ca = new CurrentAccount();
    assert.ok(ca.balance, 'balance must still be present');
    assert.ok(ca.balance.sogni, 'balance.sogni must still be present');
    assert.ok(ca.balance.spark, 'balance.spark must still be present');

    // refreshBalance still works
    const { api, client } = makeApi();
    const balances = {
      sogni: { settled: '10', credit: '0', debit: '0', net: '10', relaxedUnclaimed: '0', fastUnclaimed: '0' },
      spark: { settled: '5',  credit: '0', debit: '0', net: '5',  premiumCredit: '0', relaxedUnclaimed: '0', fastUnclaimed: '0' }
    };
    client.rest._nextPayload = apiResponse(balances);
    await api.refreshBalance();
    assert.deepEqual(api.currentAccount.balance, balances, 'refreshBalance() must still update balance');
  }

  // ── 10. Public type exports reachable from package root ──────────────────

  {
    // These would throw a require() error if not exported.
    const pkgRoot = require('../dist/index.js');

    // Value exports (classes + functions)
    assert.ok(typeof pkgRoot.CurrentAccount === 'function', 'CurrentAccount must be exported');
    assert.ok(typeof pkgRoot.ApiError === 'function',        'ApiError must be exported');

    // Type-level exports: in CJS compiled output types are elided, but
    // symbols that share name with runtime values are present.
    // For pure-type exports we just verify the module loads cleanly (no throw above).
    // The TS compiler catching wrong shapes is the real guard.
  }

  console.log('check-subscription-api: ALL TESTS PASSED');
}

run().catch((err) => {
  console.error('check-subscription-api: FAIL');
  console.error(err);
  process.exitCode = 1;
});
