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
const ChatApi = require('../dist/Chat/index.js').default;
const {
  ChatJobError,
  extractChatJobErrorFields
} = require('../dist/Chat/ChatJobError.js');
const { ApiError } = require('../dist/ApiClient/index.js');
const { SUBSCRIPTION_ERROR_CODES } = require('../dist/types/ErrorData.js');

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
  constructor() {
    super();
    this._sent = [];
  }

  get isConnected() {
    return false;
  }

  get supernetType() {
    return 'fast';
  }

  async send(messageType, data) {
    this._sent.push({ messageType, data });
  }
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

function makeChatApi() {
  const client = makeStubClient();
  const api = new ChatApi({ client, eip712: {} });
  return { api, client };
}

const CHAT_MESSAGES = [{ role: 'user', content: 'hi' }];

function flushMicrotasks() {
  return new Promise((resolve) => setImmediate(resolve));
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
      term: 'annual',
      provider: 'stripe',
      currentPeriodStart: '2026-06-01T00:00:00.000Z',
      currentPeriodEnd: '2026-07-01T00:00:00.000Z',
      cancelAtPeriodEnd: false,
      // Pending plan-change fields must pass through untouched (downgrades
      // apply at renewal; the current tier keeps benefits until then).
      scheduledTier: 'unlimited',
      scheduledTerm: 'monthly',
      scheduledChangeAt: '2026-07-01T00:00:00.000Z'
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
    client.rest._nextPayload = apiResponse({
      url: 'https://checkout.stripe.com/pay/cs_test_trial'
    });

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
    // The server ALWAYS returns a reasonCode, including 'eligible' when true.
    client.rest._nextPayload = apiResponse({ eligible: true, reasonCode: 'eligible' });

    const eligible = await api.getTrialEligibility();
    assert.equal(
      client.rest._lastCall.endpoint,
      '/v1/subscriptions/trial-eligibility',
      'getTrialEligibility() must GET /v1/subscriptions/trial-eligibility'
    );
    assert.equal(client.rest._lastCall.method, 'GET');
    assert.deepEqual(
      eligible,
      { eligible: true, reasonCode: 'eligible' },
      "getTrialEligibility() must surface reasonCode 'eligible' when eligible"
    );

    client.rest._nextPayload = apiResponse({ eligible: false, reasonCode: 'wallet_already_used' });
    const ineligible = await api.getTrialEligibility();
    assert.deepEqual(
      ineligible,
      { eligible: false, reasonCode: 'wallet_already_used' },
      'getTrialEligibility() must surface the deny reasonCode'
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
    // getSubscriptionStatus() must NOT carry trial usage fields — those come
    // only from GET /v1/subscriptions/usage. The /status snapshot the real
    // server returns (buildEntitlementSnapshot) never includes them.
    const { api, client } = makeApi();
    const snapshot = {
      active: true,
      status: 'trialing',
      tier: 'unlimited',
      provider: 'stripe',
      currentPeriodStart: '2026-06-13T00:00:00.000Z',
      currentPeriodEnd: '2026-07-01T00:00:00.000Z',
      cancelAtPeriodEnd: false
    };
    client.rest._nextPayload = apiResponse({ subscription: snapshot });

    const result = await api.getSubscriptionStatus();
    assert.deepEqual(
      result,
      snapshot,
      'getSubscriptionStatus() must unwrap data.subscription without inventing trial fields'
    );
    assert.equal(
      result.trialCreditsUsed,
      undefined,
      'getSubscriptionStatus() must NOT carry trial usage fields'
    );
  }

  {
    // getSubscriptionUsage() must GET /v1/subscriptions/usage and unwrap
    // data.usage, surfacing the trial fields the server nests there while
    // trialing.
    const { api, client } = makeApi();
    const usage = {
      periodRenderSpark: 312,
      periodJobs: 24,
      trialEndsAt: '2026-06-16T00:00:00.000Z',
      trialCreditsLimit: 500,
      trialCreditsUsed: 120
    };
    client.rest._nextPayload = apiResponse({ usage });

    const result = await api.getSubscriptionUsage();

    assert.equal(
      client.rest._lastCall.endpoint,
      '/v1/subscriptions/usage',
      'getSubscriptionUsage() must GET /v1/subscriptions/usage'
    );
    assert.equal(client.rest._lastCall.method, 'GET');
    assert.deepEqual(result, usage, 'getSubscriptionUsage() must unwrap data.usage');
    assert.equal(result.trialCreditsUsed, 120);
    assert.equal(result.trialCreditsLimit, 500);
    assert.equal(result.trialEndsAt, '2026-06-16T00:00:00.000Z');

    // Non-trial response: trial fields are omitted entirely by the server.
    client.rest._nextPayload = apiResponse({ usage: { periodRenderSpark: 0, periodJobs: 0 } });
    const nonTrial = await api.getSubscriptionUsage();
    assert.deepEqual(
      nonTrial,
      { periodRenderSpark: 0, periodJobs: 0 },
      'getSubscriptionUsage() must surface a non-trial usage shape unchanged'
    );
    assert.equal(nonTrial.trialCreditsUsed, undefined);
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

    // Grace never grants entitlement: access pauses while the provider
    // retries the renewal payment, so the server always projects active=false.
    ca._update({ subscription: { active: false, status: 'grace_period', tier: 'unlimited' } });
    assert.equal(
      ca.isUnlimited,
      false,
      'isUnlimited must be false during grace (access pauses while the renewal payment retries)'
    );

    ca._update({ subscription: { active: false, status: 'grace_period', tier: 'unlimited_pro' } });
    assert.equal(
      ca.isUnlimited,
      false,
      'grace never grants entitlement regardless of tier — active is false until the renewal succeeds'
    );

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
      'SubscriptionUsage',
      'SubscriptionPlan',
      'SubscriptionPlanId',
      'SubscriptionRedirectType',
      'SubscriptionCheckoutResult',
      'SubscriptionPortalSession',
      'CreateSubscriptionCheckoutOptions',
      'TrialEligibility',
      'TrialReasonCode'
    ]) {
      assert.ok(
        declarations.includes(exportedType),
        `${exportedType} must be exported from root declarations`
      );
    }

    // The Account API declarations must surface the new usage method so the
    // trial usage fields are reachable from the type that actually carries them.
    const accountDeclarations = fs.readFileSync(
      path.join(__dirname, '../dist/Account/index.d.ts'),
      'utf8'
    );
    assert.ok(
      accountDeclarations.includes('getSubscriptionUsage'),
      'getSubscriptionUsage must be part of the public Account API surface'
    );
  }

  // ---------------------------------------------------------------------
  // Socket entitlement mapper: real producer status domain + lossy fields
  // ---------------------------------------------------------------------

  const PERIOD_START = Date.UTC(2026, 5, 1); // 2026-06-01T00:00:00.000Z
  const PERIOD_END = Date.UTC(2026, 6, 1); // 2026-07-01T00:00:00.000Z
  const GRACE_END = Date.UTC(2026, 6, 8); // 2026-07-08T00:00:00.000Z

  function socketEntitlement(overrides = {}, subOverrides = {}) {
    return {
      active: true,
      trialing: false,
      trialCapped: false,
      subscription: {
        provider: 'stripe',
        tier: 'unlimited',
        term: 'monthly',
        status: 'active',
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
        graceEnd: 0,
        trialEnd: 0,
        version: null,
        ...subOverrides
      },
      ...overrides
    };
  }

  {
    // mapSocketSubscriptionEntitlement maps the REAL producer status domain
    // (trialing/active/grace/cancelled/expired/revoked/needs_reconciliation)
    // to REST snapshot statuses, converting epoch ms to ISO strings.
    const { api } = makeApi();
    const map = (data) => api.mapSocketSubscriptionEntitlement(data);

    assert.equal(map(undefined), undefined, 'mapper must return undefined for missing payloads');
    assert.deepEqual(
      map({ active: false, trialing: false, trialCapped: false, subscription: null }),
      { active: false, status: 'none' },
      'a null subscription object must map to an inactive none snapshot'
    );

    assert.deepEqual(
      map(socketEntitlement()),
      {
        active: true,
        status: 'active',
        tier: 'unlimited',
        term: 'monthly',
        provider: 'stripe',
        currentPeriodStart: '2026-06-01T00:00:00.000Z',
        currentPeriodEnd: '2026-07-01T00:00:00.000Z',
        capabilities: { unlimited: true }
      },
      "producer 'active' must map to 'active' with epoch ms converted to ISO timestamps"
    );

    assert.equal(
      map(socketEntitlement({}, { status: 'trialing' })).status,
      'trialing',
      "producer 'trialing' must map to 'trialing'"
    );

    const grace = map(
      socketEntitlement({ active: false }, { status: 'grace', graceEnd: GRACE_END })
    );
    assert.equal(grace.status, 'grace_period', "producer 'grace' must map to 'grace_period'");
    assert.equal(grace.active, false, 'grace is never entitled — active must stay false');
    assert.equal(
      grace.currentPeriodEnd,
      '2026-07-08T00:00:00.000Z',
      'grace must project graceEnd into currentPeriodEnd (the renewal-retry window end)'
    );
    assert.deepEqual(grace.capabilities, {}, 'inactive grace must not fabricate capabilities');

    const graceNoEnd = map(socketEntitlement({ active: false }, { status: 'grace' }));
    assert.equal(
      graceNoEnd.currentPeriodEnd,
      '2026-07-01T00:00:00.000Z',
      'grace without graceEnd (older sockets) must fall back to periodEnd'
    );

    const cancelRunning = map(socketEntitlement({ active: true }, { status: 'cancelled' }));
    assert.equal(
      cancelRunning.status,
      'cancel_at_period_end',
      "producer 'cancelled' with active=true must map to 'cancel_at_period_end'"
    );
    assert.equal(
      cancelRunning.cancelAtPeriodEnd,
      true,
      "producer 'cancelled' must infer cancelAtPeriodEnd when the socket omits the flag"
    );

    const cancelEnded = map(socketEntitlement({ active: false }, { status: 'cancelled' }));
    assert.equal(
      cancelEnded.status,
      'canceled',
      "producer 'cancelled' with active=false must map to 'canceled'"
    );

    assert.equal(
      map(socketEntitlement({ active: false }, { status: 'expired' })).status,
      'expired',
      "producer 'expired' must map to 'expired'"
    );
    assert.equal(
      map(socketEntitlement({ active: false }, { status: 'revoked' })).status,
      'canceled',
      "producer 'revoked' must map to 'canceled' (mirrors the REST snapshot mapping)"
    );
    assert.equal(
      map(socketEntitlement({ active: false }, { status: 'needs_reconciliation' })).status,
      'past_due',
      "producer 'needs_reconciliation' must map to 'past_due' (mirrors the REST snapshot mapping)"
    );
  }

  {
    // Newer socket payload fields must pass through: explicit cancelAtPeriodEnd
    // wins over the status inference, scheduled-change fields surface with
    // epoch ms converted to ISO, and provided capabilities are not clobbered.
    const { api } = makeApi();
    const map = (data) => api.mapSocketSubscriptionEntitlement(data);

    assert.equal(
      map(socketEntitlement({ active: true }, { status: 'cancelled', cancelAtPeriodEnd: false }))
        .cancelAtPeriodEnd,
      false,
      'an explicit cancelAtPeriodEnd:false must win over the cancelled-status inference'
    );
    assert.equal(
      map(socketEntitlement({}, { cancelAtPeriodEnd: true })).cancelAtPeriodEnd,
      true,
      'an explicit cancelAtPeriodEnd:true must pass through on non-cancelled statuses'
    );
    assert.equal(
      map(socketEntitlement()).cancelAtPeriodEnd,
      undefined,
      'cancelAtPeriodEnd must stay absent when the socket omits it and status is not cancelled'
    );

    const scheduled = map(
      socketEntitlement(
        {},
        {
          tier: 'unlimited_pro',
          scheduledTier: 'unlimited',
          scheduledTerm: 'monthly',
          scheduledChangeAt: PERIOD_END
        }
      )
    );
    assert.equal(scheduled.scheduledTier, 'unlimited', 'scheduledTier must pass through');
    assert.equal(scheduled.scheduledTerm, 'monthly', 'scheduledTerm must pass through');
    assert.equal(
      scheduled.scheduledChangeAt,
      '2026-07-01T00:00:00.000Z',
      'scheduledChangeAt must convert epoch ms to an ISO timestamp'
    );

    const unscheduled = map(socketEntitlement());
    assert.equal(unscheduled.scheduledTier, undefined, 'no scheduledTier when none is pending');
    assert.equal(unscheduled.scheduledTerm, undefined, 'no scheduledTerm when none is pending');
    assert.equal(
      unscheduled.scheduledChangeAt,
      undefined,
      'no scheduledChangeAt when none is pending'
    );

    assert.deepEqual(
      map(socketEntitlement({}, { capabilities: { unlimited: true, priority_queue: true } }))
        .capabilities,
      { unlimited: true, priority_queue: true },
      'server-provided capabilities must pass through without being clobbered'
    );
    assert.deepEqual(
      map(socketEntitlement()).capabilities,
      { unlimited: true },
      'capabilities must only be fabricated locally when the payload omits them'
    );
  }

  {
    // handleSubscriptionEntitlementUpdated must write the mapped snapshot into
    // currentAccount via the socket event.
    const { api, client } = makeApi();
    client.socket.emit('subscriptionEntitlementUpdated', socketEntitlement({}, { version: '3' }));

    assert.equal(api.currentAccount.subscription?.status, 'active');
    assert.equal(api.currentAccount.subscription?.tier, 'unlimited');
    assert.equal(api.currentAccount.isUnlimited, true);
  }

  {
    // authenticated-event seeding must populate the snapshot without any REST
    // call when the payload carries an entitlement.
    const { api, client } = makeApi();
    client.socket.emit('authenticated', {
      username: 'tester',
      address: '0xabc',
      subscriptionEntitlement: socketEntitlement({}, { version: '4' })
    });
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(api.currentAccount.subscription?.status, 'active');
    assert.equal(
      client.rest._lastCall,
      null,
      'authenticated seeding must not trigger a REST refresh when entitlement was provided'
    );
  }

  {
    // Reconnect fallback: an authenticated payload with NO entitlement (older
    // socket or flag off) must schedule a best-effort REST refresh.
    const { api, client } = makeApi();
    const snapshot = { active: true, status: 'active', tier: 'unlimited' };
    client.rest._nextPayload = apiResponse({ subscription: snapshot });

    client.socket.emit('authenticated', { username: 'tester', address: '0xabc' });
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(
      client.rest._lastCall?.endpoint,
      '/v1/subscriptions/status',
      'authenticated without entitlement must fall back to a REST subscription refresh'
    );
    assert.deepEqual(api.currentAccount.subscription, snapshot);
  }

  {
    // Version guard: a stale REST response that started before a socket push
    // was applied must be discarded instead of overwriting the fresher push.
    const { api, client } = makeApi();
    const socketPush = socketEntitlement({ active: true }, { version: '2' });

    const staleRestSnapshot = { active: false, status: 'none' };
    const originalGet = client.rest.get.bind(client.rest);
    client.rest.get = async (endpoint, query) => {
      // Simulate the socket push landing while the REST request is in flight.
      client.socket.emit('subscriptionEntitlementUpdated', socketPush);
      return originalGet(endpoint, query);
    };
    client.rest._nextPayload = apiResponse({ subscription: staleRestSnapshot });

    const result = await api.getSubscriptionStatus();

    assert.equal(
      api.currentAccount.subscription?.status,
      'active',
      'the socket push applied mid-flight must win over the stale REST response'
    );
    assert.equal(
      result.status,
      'active',
      'getSubscriptionStatus() must return the fresher cached snapshot when REST is discarded'
    );
    assert.equal(api.currentAccount.isUnlimited, true);
  }

  {
    // Version guard: REST applies normally when no socket push lands mid-flight.
    const { api, client } = makeApi();
    client.socket.emit('subscriptionEntitlementUpdated', socketEntitlement({}, { version: '2' }));

    const restSnapshot = { active: false, status: 'canceled', tier: 'unlimited' };
    client.rest._nextPayload = apiResponse({ subscription: restSnapshot });
    const result = await api.getSubscriptionStatus();

    assert.deepEqual(result, restSnapshot);
    assert.deepEqual(
      api.currentAccount.subscription,
      restSnapshot,
      'a REST refresh started after the socket push must apply normally'
    );
  }

  {
    // Version guard: a socket push older than the applied version is ignored,
    // while a missing version still applies conservatively.
    const { api, client } = makeApi();
    client.socket.emit(
      'subscriptionEntitlementUpdated',
      socketEntitlement({}, { version: '5', tier: 'unlimited_pro' })
    );
    assert.equal(api.currentAccount.subscription?.tier, 'unlimited_pro');

    client.socket.emit(
      'subscriptionEntitlementUpdated',
      socketEntitlement({ active: false }, { version: '3', status: 'expired' })
    );
    assert.equal(
      api.currentAccount.subscription?.tier,
      'unlimited_pro',
      'a socket push with a lower version than the applied one must be ignored'
    );
    assert.equal(api.currentAccount.subscription?.status, 'active');

    client.socket.emit(
      'subscriptionEntitlementUpdated',
      socketEntitlement({ active: false }, { version: null, status: 'expired' })
    );
    assert.equal(
      api.currentAccount.subscription?.status,
      'expired',
      'a socket push without a version must apply conservatively'
    );
  }

  {
    // Redundant emits: re-applying a deep-equal snapshot (reconnect re-seed /
    // tab replay) must not emit another 'updated' event.
    const { api, client } = makeApi();
    let subscriptionUpdates = 0;
    api.currentAccount.on('updated', (keys) => {
      if (keys.includes('subscription')) subscriptionUpdates += 1;
    });

    client.socket.emit('subscriptionEntitlementUpdated', socketEntitlement({}, { version: '2' }));
    client.socket.emit('subscriptionEntitlementUpdated', socketEntitlement({}, { version: '2' }));
    assert.equal(
      subscriptionUpdates,
      1,
      'an identical entitlement re-seed must not emit a redundant updated event'
    );

    client.socket.emit(
      'subscriptionEntitlementUpdated',
      socketEntitlement({ active: false }, { version: '3', status: 'expired' })
    );
    assert.equal(subscriptionUpdates, 2, 'a changed snapshot must still emit an updated event');
  }

  {
    // Logout must reset both the snapshot and the version guard so the next
    // login starts from a clean slate.
    const { api, client } = makeApi();
    client.socket.emit('subscriptionEntitlementUpdated', socketEntitlement({}, { version: '5' }));
    assert.equal(api.currentAccount.isUnlimited, true);

    client.auth.emit('updated', false);
    assert.equal(api.currentAccount.subscription, undefined, 'logout must clear the snapshot');

    client.socket.emit(
      'subscriptionEntitlementUpdated',
      socketEntitlement({}, { version: '1', tier: 'unlimited_pro' })
    );
    assert.equal(
      api.currentAccount.subscription?.tier,
      'unlimited_pro',
      'after logout the version guard must reset and accept lower versions again'
    );
  }

  // ---------------------------------------------------------------------
  // Chat transports: billingMode serialization
  // ---------------------------------------------------------------------

  {
    // Socket transport (llmJobRequest): billingMode must be serialized when
    // set and absent when not — the socket server reads data.billingMode.
    const { api, client } = makeChatApi();

    await api.completions.create({
      model: 'qwen3.6-test',
      messages: CHAT_MESSAGES,
      stream: true,
      tokenType: 'spark',
      billingMode: 'subscription'
    });
    const withMode = client.socket._sent.at(-1);
    assert.equal(withMode.messageType, 'llmJobRequest');
    assert.equal(
      withMode.data.billingMode,
      'subscription',
      'socket llmJobRequest must carry billingMode when set'
    );
    assert.equal(withMode.data.tokenType, 'spark');

    await api.completions.create({ model: 'qwen3.6-test', messages: CHAT_MESSAGES, stream: true });
    assert.ok(
      !('billingMode' in client.socket._sent.at(-1).data),
      'socket llmJobRequest must omit billingMode when not set'
    );
  }

  {
    // Hosted REST transport (POST /v1/chat/completions): billingMode in the
    // body when set, absent when not.
    const { api, client } = makeChatApi();
    client.rest._nextPayload = {
      id: 'chatcmpl-1',
      object: 'chat.completion',
      created: 1,
      model: 'qwen3.6-test',
      choices: []
    };

    await api.hosted.create({
      model: 'qwen3.6-test',
      messages: CHAT_MESSAGES,
      billingMode: 'subscription'
    });
    assert.equal(client.rest._lastCall.endpoint, '/v1/chat/completions');
    assert.equal(
      client.rest._lastCall.body.billingMode,
      'subscription',
      'hosted REST body must carry billingMode when set'
    );

    await api.hosted.create({ model: 'qwen3.6-test', messages: CHAT_MESSAGES });
    assert.ok(
      !('billingMode' in client.rest._lastCall.body),
      'hosted REST body must omit billingMode when not set'
    );
  }

  {
    // Durable run transport (POST /v1/chat/runs): serialized as billing_mode
    // to match the body's snake_case convention (the api accepts both).
    const { api } = makeChatApi();
    const fetchCalls = [];
    const originalFetch = global.fetch;
    global.fetch = async (url, init) => {
      fetchCalls.push({ url, init });
      return {
        ok: true,
        async json() {
          return { status: 'success', data: { run: { runId: 'run_1', status: 'queued' } } };
        }
      };
    };
    try {
      const run = await api.runs.create({
        messages: CHAT_MESSAGES,
        tokenType: 'spark',
        billingMode: 'subscription'
      });
      assert.equal(run.runId, 'run_1');
      const body = JSON.parse(fetchCalls.at(-1).init.body);
      assert.equal(
        body.billing_mode,
        'subscription',
        'durable run body must carry billing_mode when set'
      );
      assert.equal(body.token_type, 'spark');
      assert.ok(!('billingMode' in body), 'durable run body must use snake_case billing_mode');

      await api.runs.create({ messages: CHAT_MESSAGES });
      const bare = JSON.parse(fetchCalls.at(-1).init.body);
      assert.ok(
        !('billing_mode' in bare) && !('billingMode' in bare),
        'durable run body must omit billing mode entirely when not set'
      );
    } finally {
      global.fetch = originalFetch;
    }
  }

  {
    // billingMode must be part of the public chat param types, reusing the
    // BillingMode union exported from the package root.
    const chatTypeDeclarations = fs.readFileSync(
      path.join(__dirname, '../dist/Chat/types.d.ts'),
      'utf8'
    );
    const billingModeFields = chatTypeDeclarations.match(/billingMode\?: BillingMode;/g) ?? [];
    assert.ok(
      billingModeFields.length >= 3,
      'billingMode must be typed on ChatCompletionParams, ChatRequestMessage, and StartChatRunParams'
    );

    const declarations = fs.readFileSync(path.join(__dirname, '../dist/index.d.ts'), 'utf8');
    assert.ok(
      declarations.includes('BillingMode'),
      'BillingMode must be exported from root declarations'
    );
  }

  // ---------------------------------------------------------------------
  // ChatJobError: subscription denial codes preserved on failure paths
  // ---------------------------------------------------------------------

  {
    // Socket stream failure: llmJobError with error_code '4080' must surface
    // a ChatJobError carrying code/errorCode/errorType, message unchanged.
    const { api, client } = makeChatApi();
    const emittedErrors = [];
    api.on('error', (event) => emittedErrors.push(event));

    const stream = await api.completions.create({
      model: 'qwen3.6-test',
      messages: CHAT_MESSAGES,
      stream: true,
      billingMode: 'subscription'
    });
    const { jobID } = client.socket._sent.at(-1).data;
    client.socket.emit('llmJobError', {
      jobID,
      error: 'subscription_unavailable',
      error_code: '4080',
      error_message: 'Subscription renewal payment is being retried'
    });

    let failure;
    try {
      for await (const chunk of stream) {
        void chunk;
      }
    } catch (err) {
      failure = err;
    }
    assert.ok(failure instanceof ChatJobError, 'stream failure must be a ChatJobError');
    assert.equal(
      failure.message,
      'Subscription renewal payment is being retried',
      'message must stay the server error_message'
    );
    assert.equal(failure.code, '4080');
    assert.equal(failure.errorCode, '4080');
    assert.equal(failure.errorType, 'subscription_unavailable');
    assert.equal(failure.jobID, jobID);
    assert.equal(
      failure.subscriptionErrorCode,
      SUBSCRIPTION_ERROR_CODES.GRACE_RETRY,
      'string wire code must map back to the numeric SUBSCRIPTION_ERROR_CODES constant'
    );

    assert.equal(emittedErrors.length, 1);
    assert.equal(
      emittedErrors[0].errorCode,
      '4080',
      "the emitted 'error' event must carry errorCode"
    );
    assert.equal(emittedErrors[0].error, 'subscription_unavailable');
  }

  {
    // Non-streaming completion rejection must keep the composed message and
    // still carry the denial code; errors without error_code keep code
    // undefined (and no fabricated subscription mapping).
    const { api, client } = makeChatApi();

    const pending = api.completions.create({ model: 'qwen3.6-test', messages: CHAT_MESSAGES });
    await flushMicrotasks();
    const { jobID } = client.socket._sent.at(-1).data;
    client.socket.emit('llmJobError', {
      jobID,
      error: 'subscription_unavailable',
      error_code: '4078',
      error_message: 'No active subscription'
    });
    await assert.rejects(pending, (err) => {
      assert.ok(err instanceof ChatJobError);
      assert.equal(err.message, 'subscription_unavailable: No active subscription');
      assert.equal(err.code, '4078');
      assert.equal(err.errorType, 'subscription_unavailable');
      assert.equal(err.subscriptionErrorCode, SUBSCRIPTION_ERROR_CODES.NOT_ENTITLED);
      return true;
    });

    const streamNoCode = await api.completions.create({
      model: 'qwen3.6-test',
      messages: CHAT_MESSAGES,
      stream: true
    });
    const noCodeJobID = client.socket._sent.at(-1).data.jobID;
    client.socket.emit('llmJobError', {
      jobID: noCodeJobID,
      error: 'model_unavailable',
      error_message: 'Model "x" is not currently available'
    });
    let noCodeFailure;
    try {
      for await (const chunk of streamNoCode) {
        void chunk;
      }
    } catch (err) {
      noCodeFailure = err;
    }
    assert.ok(noCodeFailure instanceof ChatJobError);
    assert.equal(noCodeFailure.code, undefined, 'errors without error_code must not invent one');
    assert.equal(noCodeFailure.errorType, 'model_unavailable');
    assert.equal(noCodeFailure.subscriptionErrorCode, undefined);
  }

  {
    // Hosted REST failure: an OpenAI-style error envelope (sogni-socket
    // handleHTTPLLMJobRequest shape forwarded by /v1/chat/completions) must
    // convert to ChatJobError; unrecognized ApiErrors pass through untouched.
    const { api, client } = makeChatApi();

    client.rest.post = async () => {
      throw new ApiError(402, {
        error: {
          message: 'Subscription cannot cover this job',
          type: 'subscription_unavailable',
          code: '4078'
        }
      });
    };
    await assert.rejects(
      api.hosted.create({ model: 'qwen3.6-test', messages: CHAT_MESSAGES }),
      (err) => {
        assert.ok(err instanceof ChatJobError, 'envelope-shaped 402 must become ChatJobError');
        assert.equal(err.code, '4078');
        assert.equal(err.errorType, 'subscription_unavailable');
        assert.equal(err.status, 402);
        assert.equal(err.message, 'Subscription cannot cover this job');
        return true;
      }
    );

    client.rest.post = async () => {
      throw new ApiError(500, { status: 'error', message: 'boom', errorCode: 1234 });
    };
    await assert.rejects(
      api.hosted.create({ model: 'qwen3.6-test', messages: CHAT_MESSAGES }),
      (err) => {
        assert.ok(err instanceof ApiError, 'generic api errors must stay ApiError');
        assert.ok(!(err instanceof ChatJobError));
        assert.equal(err.message, 'boom');
        return true;
      }
    );
  }

  {
    // Durable run REST failure with a recognized envelope must also surface
    // typed fields while keeping the legacy message computation.
    const { api } = makeChatApi();
    const originalFetch = global.fetch;
    global.fetch = async () => ({
      ok: false,
      status: 402,
      statusText: 'Payment Required',
      async text() {
        return JSON.stringify({
          error: {
            message: 'Subscription cannot cover this job',
            type: 'subscription_unavailable',
            code: '4080'
          }
        });
      }
    });
    try {
      await assert.rejects(api.runs.create({ messages: CHAT_MESSAGES }), (err) => {
        assert.ok(err instanceof ChatJobError);
        assert.equal(err.message, 'Payment Required', 'message computation must stay unchanged');
        assert.equal(err.code, '4080');
        assert.equal(err.errorType, 'subscription_unavailable');
        assert.equal(err.status, 402);
        return true;
      });
    } finally {
      global.fetch = originalFetch;
    }
  }

  {
    // ChatJobError must be reachable from the package root so apps can
    // instanceof/type-narrow chat job failures.
    const pkgRoot = require('../dist/index.js');
    assert.equal(typeof pkgRoot.ChatJobError, 'function', 'ChatJobError must be exported');
    const declarations = fs.readFileSync(path.join(__dirname, '../dist/index.d.ts'), 'utf8');
    assert.ok(
      declarations.includes('ChatJobErrorFields'),
      'ChatJobErrorFields must be exported from root declarations'
    );
  }

  // ---------------------------------------------------------------------
  // 'chat' checkout redirect target
  // ---------------------------------------------------------------------

  {
    const { api, client } = makeApi();
    client.rest._nextPayload = apiResponse({ url: 'https://checkout.stripe.com/pay/cs_test_chat' });

    await api.createSubscriptionCheckout('unlimited', 'monthly', {
      redirectType: 'chat',
      appSource: 'sogni-chat'
    });
    assert.deepEqual(
      client.rest._lastCall.body,
      { planId: 'unlimited', term: 'monthly', redirectType: 'chat', appSource: 'sogni-chat' },
      "createSubscriptionCheckout() must pass redirectType 'chat' through"
    );

    const redirectDeclarations = fs.readFileSync(
      path.join(__dirname, '../dist/Account/subscription.types.d.ts'),
      'utf8'
    );
    assert.match(
      redirectDeclarations,
      /SubscriptionRedirectType = [^;]*'chat'/,
      "SubscriptionRedirectType must accept 'chat'"
    );
  }

  // ---------------------------------------------------------------------
  // Subscription FEATURE-limit (code 4081): const + structured ErrorData
  // ---------------------------------------------------------------------

  {
    // 4081 must be a recognized subscription error code so downstream
    // getters/helpers treat a feature-gate denial as a subscription denial.
    assert.equal(
      SUBSCRIPTION_ERROR_CODES.SUBSCRIPTION_FEATURE_REQUIRES_UPGRADE,
      4081,
      'SUBSCRIPTION_ERROR_CODES must define SUBSCRIPTION_FEATURE_REQUIRES_UPGRADE = 4081'
    );
    const known = Object.values(SUBSCRIPTION_ERROR_CODES);
    assert.ok(known.includes(4081), '4081 must be enumerable in SUBSCRIPTION_ERROR_CODES');
    assert.ok(
      known.includes(4078) && known.includes(4079) && known.includes(4080),
      'the existing subscription denial codes must remain intact'
    );
  }

  {
    // Shape 2 (flat socket llmJobError): the 5 contract fields are FLAT.
    const flat = extractChatJobErrorFields({
      error: 'subscription_unavailable',
      error_code: '4081',
      error_message: '4K video render requires Unlimited Pro',
      subscriptionLimit: true,
      requiredPlans: ['unlimited_pro'],
      feature: 'video_4k_render',
      limitation: '4K video render requires Unlimited Pro'
    });
    assert.ok(flat, 'flat socket shape with a code must be recognized');
    assert.equal(flat.code, '4081');
    assert.equal(flat.subscriptionLimit, true, 'flat shape must surface subscriptionLimit');
    assert.deepEqual(flat.requiredPlans, ['unlimited_pro']);
    assert.equal(flat.feature, 'video_4k_render');
    assert.equal(flat.limitation, '4K video render requires Unlimited Pro');

    // Shape 1 (OpenAI envelope): the 5 fields live under error.subscription.
    const nested = extractChatJobErrorFields({
      error: {
        message: '4K video render requires Unlimited Pro',
        type: 'subscription_unavailable',
        code: '4081',
        subscription: {
          subscriptionLimit: true,
          requiredPlans: ['unlimited_pro'],
          feature: 'video_4k_render',
          limitation: '4K video render requires Unlimited Pro'
        }
      }
    });
    assert.ok(nested, 'OpenAI envelope must be recognized');
    assert.equal(nested.code, '4081');
    assert.equal(nested.subscriptionLimit, true, 'envelope must read error.subscription');
    assert.deepEqual(nested.requiredPlans, ['unlimited_pro']);
    assert.equal(nested.feature, 'video_4k_render');
    assert.equal(nested.limitation, '4K video render requires Unlimited Pro');

    // The class must carry the fields and recognize 4081 as a subscription code.
    const err = new ChatJobError(flat.message, {
      code: flat.code,
      errorType: flat.errorType,
      subscriptionLimit: flat.subscriptionLimit,
      requiredPlans: flat.requiredPlans,
      feature: flat.feature,
      limitation: flat.limitation
    });
    assert.equal(err.subscriptionErrorCode, 4081, 'ChatJobError must recognize 4081');
    assert.equal(err.subscriptionLimit, true);
    assert.deepEqual(err.requiredPlans, ['unlimited_pro']);
    assert.equal(err.feature, 'video_4k_render');
    assert.equal(err.limitation, '4K video render requires Unlimited Pro');
  }

  console.log('check-subscription-api: ALL TESTS PASSED');
}

run().catch((err) => {
  console.error('check-subscription-api: FAIL');
  console.error(err);
  process.exitCode = 1;
});
