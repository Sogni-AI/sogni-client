/**
 * Smoke tests for the subscription SDK surface.
 *
 * Runs against compiled `dist/` output so it also verifies public declaration
 * files and CommonJS imports after a real build.
 */

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const AccountApi = require('../dist/Account/index.js').default;
const CurrentAccount = require('../dist/Account/CurrentAccount.js').default;

class StubAuth {
  constructor() {
    this.isAuthenticated = true;
  }

  async authenticateRequest(init) {
    return init ?? {};
  }

  clear() {
    this.isAuthenticated = false;
  }

  on() {}
  off() {}
}

class StubSocket {
  get isConnected() {
    return false;
  }

  get supernetType() {
    return 'fast';
  }

  on() {}
  off() {}
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
    appId: 'subscription-test',
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

function apiResponse(data) {
  return { status: 'success', data };
}

async function run() {
  {
    const { api, client } = makeApi();
    const snapshot = {
      active: true,
      status: 'active',
      tier: 'unlimited',
      provider: 'stripe',
      currentPeriodStart: '2026-06-01T00:00:00.000Z',
      currentPeriodEnd: '2026-07-01T00:00:00.000Z',
      cancelAtPeriodEnd: false
    };
    client.rest._nextPayload = apiResponse({ subscription: snapshot });

    const result = await api.getSubscriptionStatus();

    assert.equal(
      client.rest._lastCall.endpoint,
      '/v1/subscriptions/status',
      'getSubscriptionStatus() must GET /v1/subscriptions/status'
    );
    assert.equal(client.rest._lastCall.method, 'GET');
    assert.deepEqual(result, snapshot, 'getSubscriptionStatus() must unwrap data.subscription');
    assert.deepEqual(
      api.currentAccount.subscription,
      snapshot,
      'getSubscriptionStatus() must update currentAccount.subscription'
    );
    assert.equal(api.currentAccount.isUnlimited, true);
  }

  {
    const { api, client } = makeApi();
    const plans = [
      {
        planId: 'unlimited',
        tier: 'unlimited',
        term: 'monthly',
        interval: 'month',
        priceUsd: 20,
        displayName: 'Unlimited (Monthly)'
      },
      {
        planId: 'unlimited_pro',
        tier: 'unlimited_pro',
        term: 'annual',
        interval: 'year',
        priceUsd: 498,
        displayName: 'Unlimited Pro (Annual)'
      }
    ];
    client.rest._nextPayload = apiResponse({ plans });

    const result = await api.getSubscriptionPlans();

    assert.equal(
      client.rest._lastCall.endpoint,
      '/v1/subscriptions/plans',
      'getSubscriptionPlans() must GET /v1/subscriptions/plans'
    );
    assert.deepEqual(result, plans, 'getSubscriptionPlans() must unwrap data.plans');
    assert.equal(result[1].planId, 'unlimited_pro');
    assert.equal(result[1].priceUsd, 498);
  }

  {
    const { api, client } = makeApi();
    client.rest._nextPayload = apiResponse({
      message: 'Stripe subscription session created',
      url: 'https://checkout.stripe.com/pay/cs_test_unlimited'
    });

    const result = await api.createSubscriptionCheckout('unlimited', 'monthly');

    assert.equal(
      client.rest._lastCall.endpoint,
      '/v1/iap/stripe/subscribe',
      'createSubscriptionCheckout() must POST /v1/iap/stripe/subscribe'
    );
    assert.deepEqual(
      client.rest._lastCall.body,
      { planId: 'unlimited', term: 'monthly', redirectType: 'web' },
      'createSubscriptionCheckout() must default redirectType to web'
    );
    assert.equal(result.url, 'https://checkout.stripe.com/pay/cs_test_unlimited');

    client.rest._nextPayload = apiResponse({ url: 'https://checkout.stripe.com/pay/cs_test_pro' });
    await api.createSubscriptionCheckout('unlimited_pro', 'annual', {
      redirectType: 'photobooth',
      appSource: 'sogni-photobooth'
    });
    assert.deepEqual(client.rest._lastCall.body, {
      planId: 'unlimited_pro',
      term: 'annual',
      redirectType: 'photobooth',
      appSource: 'sogni-photobooth'
    });
  }

  {
    const { api, client } = makeApi();
    client.rest._nextPayload = apiResponse({ url: 'https://checkout.stripe.com/pay/cs_test_trial' });

    await api.createSubscriptionCheckout('unlimited', 'monthly', {
      startTrial: true,
      deviceId: 'device-abc'
    });
    assert.deepEqual(
      client.rest._lastCall.body,
      {
        planId: 'unlimited',
        term: 'monthly',
        redirectType: 'web',
        startTrial: true,
        deviceId: 'device-abc'
      },
      'createSubscriptionCheckout() must forward startTrial and deviceId when provided'
    );

    await api.createSubscriptionCheckout('unlimited', 'monthly', { startTrial: false });
    assert.deepEqual(
      client.rest._lastCall.body,
      { planId: 'unlimited', term: 'monthly', redirectType: 'web', startTrial: false },
      'createSubscriptionCheckout() must send startTrial:false explicitly (subscribe now, no trial)'
    );

    await api.createSubscriptionCheckout('unlimited', 'monthly');
    assert.deepEqual(
      client.rest._lastCall.body,
      { planId: 'unlimited', term: 'monthly', redirectType: 'web' },
      'createSubscriptionCheckout() must omit startTrial/deviceId when not provided'
    );
  }

  {
    const { api, client } = makeApi();
    client.rest._nextPayload = apiResponse({ eligible: true });

    const eligible = await api.getTrialEligibility();
    assert.equal(
      client.rest._lastCall.endpoint,
      '/v1/subscriptions/trial-eligibility',
      'getTrialEligibility() must GET /v1/subscriptions/trial-eligibility'
    );
    assert.equal(client.rest._lastCall.method, 'GET');
    assert.deepEqual(eligible, { eligible: true, reasonCode: undefined });

    client.rest._nextPayload = apiResponse({ eligible: false, reasonCode: 'already_subscribed' });
    const ineligible = await api.getTrialEligibility();
    assert.deepEqual(
      ineligible,
      { eligible: false, reasonCode: 'already_subscribed' },
      'getTrialEligibility() must surface reasonCode when present'
    );
  }

  {
    const { api, client } = makeApi();
    client.rest._nextPayload = apiResponse(undefined);

    const result = await api.setDeviceId('device-xyz');
    assert.equal(
      client.rest._lastCall.endpoint,
      '/v1/account/device-id',
      'setDeviceId() must POST /v1/account/device-id'
    );
    assert.equal(client.rest._lastCall.method, 'POST');
    assert.deepEqual(client.rest._lastCall.body, { deviceId: 'device-xyz' });
    assert.equal(result, undefined, 'setDeviceId() resolves to void');
  }

  {
    const { api, client } = makeApi();
    const snapshot = {
      active: true,
      status: 'trialing',
      tier: 'unlimited',
      provider: 'stripe',
      currentPeriodEnd: '2026-07-01T00:00:00.000Z',
      trialEndsAt: '2026-06-16T00:00:00.000Z',
      trialCreditsLimit: 500,
      trialCreditsUsed: 120
    };
    client.rest._nextPayload = apiResponse({ subscription: snapshot });

    const result = await api.getSubscriptionStatus();
    assert.deepEqual(
      result,
      snapshot,
      'getSubscriptionStatus() must pass through trial usage fields'
    );
    assert.equal(api.currentAccount.subscription.trialCreditsUsed, 120);
  }

  {
    const { api, client } = makeApi();
    client.rest._nextPayload = apiResponse({ url: 'https://billing.stripe.com/session/bps_test' });

    const result = await api.createSubscriptionPortalSession();

    assert.equal(
      client.rest._lastCall.endpoint,
      '/v1/subscriptions/stripe/portal',
      'createSubscriptionPortalSession() must POST /v1/subscriptions/stripe/portal'
    );
    assert.equal(client.rest._lastCall.method, 'POST');
    assert.deepEqual(client.rest._lastCall.body, {});
    assert.equal(result.url, 'https://billing.stripe.com/session/bps_test');
  }

  {
    const { api, client } = makeApi();
    const snapshot = {
      active: true,
      status: 'trialing',
      tier: 'unlimited_pro',
      currentPeriodEnd: '2026-06-08T00:00:00.000Z'
    };
    client.rest._nextPayload = apiResponse({ subscription: snapshot });

    const result = await api.refreshSubscription();

    assert.equal(client.rest._lastCall.endpoint, '/v1/subscriptions/status');
    assert.deepEqual(result, snapshot);
    assert.deepEqual(api.currentAccount.subscription, snapshot);
    assert.equal(api.currentAccount.isUnlimited, true);
  }

  {
    const ca = new CurrentAccount();
    assert.equal(ca.subscription, undefined, 'subscription should start undefined');
    assert.equal(ca.isUnlimited, false, 'isUnlimited should be false when no snapshot exists');

    ca._update({ subscription: { active: false, status: 'none' } });
    assert.equal(ca.isUnlimited, false, 'isUnlimited must be false when active=false');

    ca._update({ subscription: { active: true, status: 'active', tier: 'free' } });
    assert.equal(ca.isUnlimited, false, 'isUnlimited must be false for non-unlimited tiers');

    ca._update({ subscription: { active: true, status: 'active', tier: 'unlimited' } });
    assert.equal(ca.isUnlimited, true, 'isUnlimited must be true for active unlimited');

    ca._update({ subscription: { active: true, status: 'trialing', tier: 'unlimited_pro' } });
    assert.equal(ca.isUnlimited, true, 'isUnlimited must be true for trialing unlimited_pro');

    ca._update({ subscription: { active: true, status: 'grace_period', tier: 'unlimited' } });
    assert.equal(ca.isUnlimited, true, 'isUnlimited must be true during grace period');

    ca._update({
      subscription: { active: true, status: 'cancel_at_period_end', tier: 'unlimited_pro' }
    });
    assert.equal(ca.isUnlimited, true, 'isUnlimited must stay true until period end');

    ca._clear();
    assert.equal(ca.subscription, undefined, '_clear() must reset subscription to undefined');
    assert.equal(ca.isUnlimited, false, '_clear() must reset isUnlimited to false');
  }

  {
    const ca = new CurrentAccount();
    const updatedKeys = [];
    const off = ca.on('updated', (keys) => updatedKeys.push(...keys));

    ca._update({ subscription: { active: true, status: 'active', tier: 'unlimited' } });
    assert.ok(updatedKeys.includes('subscription'), "updated event must include 'subscription'");

    off();
  }

  {
    const { api, client } = makeApi();
    const balances = {
      sogni: {
        settled: '10',
        credit: '0',
        debit: '0',
        net: '10',
        relaxedUnclaimed: '0',
        fastUnclaimed: '0'
      },
      spark: {
        settled: '5',
        credit: '0',
        debit: '0',
        net: '5',
        premiumCredit: '0',
        relaxedUnclaimed: '0',
        fastUnclaimed: '0'
      }
    };
    client.rest._nextPayload = apiResponse(balances);
    await api.refreshBalance();
    assert.deepEqual(api.currentAccount.balance, balances, 'refreshBalance() must still work');
  }

  {
    const pkgRoot = require('../dist/index.js');
    assert.equal(typeof pkgRoot.CurrentAccount, 'function', 'CurrentAccount must be exported');
    assert.equal(typeof pkgRoot.ApiError, 'function', 'ApiError must be exported');

    const declarations = fs.readFileSync(path.join(__dirname, '../dist/index.d.ts'), 'utf8');
    for (const exportedType of [
      'SubscriptionEntitlementSnapshot',
      'SubscriptionPlan',
      'SubscriptionPlanId',
      'SubscriptionRedirectType',
      'SubscriptionCheckoutResult',
      'SubscriptionPortalSession',
      'CreateSubscriptionCheckoutOptions',
      'TrialEligibility'
    ]) {
      assert.ok(
        declarations.includes(exportedType),
        `${exportedType} must be exported from root declarations`
      );
    }
    assert.equal(
      declarations.includes('getSubscriptionUsage'),
      false,
      'getSubscriptionUsage must not be part of the public SDK surface'
    );
    assert.equal(
      declarations.includes('SubscriptionUsage'),
      false,
      'SubscriptionUsage must not be exported from root declarations'
    );
  }

  console.log('check-subscription-api: ALL TESTS PASSED');
}

run().catch((err) => {
  console.error('check-subscription-api: FAIL');
  console.error(err);
  process.exitCode = 1;
});
