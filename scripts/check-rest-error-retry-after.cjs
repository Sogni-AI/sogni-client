/**
 * Regression checks for the wait and the structured context a REST error carries.
 * Runs against compiled output so it also checks the published API shape.
 *
 * Every REST surface must hand the caller `retryAfter` (seconds) and `details`
 * when the server sent them. Without the wait a caller cannot tell when a 429
 * clears, so it retries at once and is refused again.
 */

'use strict';

const assert = require('node:assert/strict');
// ApiClient first: RestClient imports ApiError from it, and ApiClient's WebSocketClient extends RestClient.
const { ApiError } = require('../dist/ApiClient/index.js');
const RestClient = require('../dist/lib/RestClient.js').default;
const CreativeWorkflowsApi = require('../dist/CreativeWorkflows/index.js').default;
const CreativeWorkflowTemplatesApi = require('../dist/CreativeWorkflows/Templates/index.js').default;
const ReplayApi = require('../dist/Replay/index.js').default;
const ChatApi = require('../dist/Chat/index.js').default;
const { parseRetryAfterHeader } = require('../dist/lib/apiErrorFields.js');

const auth = {
  isAuthenticated: false,
  clear() {},
  async authenticateRequest(init) {
    return init;
  }
};
const logger = { info() {}, warn() {}, error() {}, debug() {} };
const listeners = { on() {}, off() {} };
const client = {
  auth: { ...listeners, ...auth },
  socket: { ...listeners, isConnected: false, supernetType: 'fast', async send() {} },
  rest: { baseUrl: 'https://api.example.test' },
  appId: 'retry-after-test',
  appSource: 'sdk-test',
  logger,
  ...listeners
};
const config = { client, eip712: {} };

const RATE_LIMITED = {
  status: 'error',
  errorCode: 126,
  message: 'Creative workflow start rate limit exceeded. Wait before starting another workflow.',
  retryAfter: 1837,
  details: { retryAfterSeconds: 1837 }
};
const AT_CAPACITY = {
  status: 'error',
  errorCode: 102,
  message: 'Too many active creative workflows (10)',
  details: { activeWorkflowCount: 10, activeWorkflowLimit: 10 }
};

async function failing(call, status, body, headers = {}) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });
  try {
    await call();
  } catch (error) {
    return error;
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.fail('a non-2xx response must throw');
}

async function main() {
  const step = { toolName: 'generate_image', arguments: { prompt: 'A ceramic vase' } };
  const workflows = new CreativeWorkflowsApi(config);
  const surfaces = {
    'RestClient.post': () =>
      new RestClient('https://api.example.test', auth, logger).post('/v1/anything', {}),
    'workflows.start': () => workflows.start({ input: { steps: [step] } }),
    'workflows.reseed': () => workflows.reseed('wf_source'),
    'workflows.get': () => workflows.get('wf_source'),
    'workflows.templates.list': () => new CreativeWorkflowTemplatesApi(config).list(),
    'replay.get': () => new ReplayApi(config).get('rec_1')
  };

  for (const [name, call] of Object.entries(surfaces)) {
    // The body's wait wins over the header, and the message/errorCode are unchanged.
    let error = await failing(call, 429, RATE_LIMITED, { 'Retry-After': '9' });
    assert.ok(error instanceof ApiError, `${name}: throws ApiError`);
    assert.equal(error.status, 429, name);
    assert.equal(error.message, RATE_LIMITED.message, name);
    assert.equal(error.payload.errorCode, 126, name);
    assert.equal(error.retryAfter, 1837, `${name}: retryAfter from the body`);
    assert.equal(error.payload.retryAfter, 1837, `${name}: payload keeps retryAfter`);
    assert.deepEqual(error.details, { retryAfterSeconds: 1837 }, `${name}: details`);

    // No wait in the body: fall back to the header.
    error = await failing(call, 429, { ...RATE_LIMITED, retryAfter: undefined }, { 'Retry-After': '42' });
    assert.equal(error.retryAfter, 42, `${name}: retryAfter from the header`);

    // A refusal with context but no wait carries details and no retryAfter.
    error = await failing(call, 409, AT_CAPACITY);
    assert.equal(error.retryAfter, undefined, `${name}: no invented wait`);
    assert.equal(Object.hasOwn(error, 'retryAfter'), false, name);
    assert.deepEqual(error.details, AT_CAPACITY.details, name);

    // Garbage never becomes a wait or a details object.
    error = await failing(
      call,
      429,
      { ...RATE_LIMITED, retryAfter: '60', details: ['not', 'an', 'object'] },
      { 'Retry-After': 'soon' }
    );
    assert.equal(error.retryAfter, undefined, `${name}: a string wait in the body is ignored`);
    assert.equal(error.details, undefined, `${name}: array details are ignored`);
    for (const bad of [-5, Number.NaN, Number.POSITIVE_INFINITY, null]) {
      error = await failing(call, 429, { ...RATE_LIMITED, retryAfter: bad });
      assert.equal(error.retryAfter, undefined, `${name}: ${bad} is not a wait`);
    }
  }

  // A non-JSON 429 from a gateway still yields the header's wait.
  let error = await failing(surfaces['RestClient.post'], 429, 'Too Many Requests', {
    'Retry-After': '30'
  });
  assert.equal(error.retryAfter, 30);

  // Durable chat runs throw a plain Error with `status`; it carries the same two fields.
  const chat = new ChatApi(config);
  const startRun = () => chat.runs.create({ messages: [{ role: 'user', content: 'hi' }] });
  error = await failing(startRun, 429, { ...RATE_LIMITED, errorCode: 126 }, { 'Retry-After': '9' });
  assert.equal(error.status, 429);
  assert.equal(error.retryAfter, 1837);
  assert.deepEqual(error.details, { retryAfterSeconds: 1837 });
  error = await failing(startRun, 429, { status: 'error', message: 'slow down' }, { 'Retry-After': '7' });
  assert.equal(error.retryAfter, 7);
  error = await failing(startRun, 400, { status: 'error', message: 'bad body' });
  assert.equal(Object.hasOwn(error, 'retryAfter'), false);

  // Retry-After header forms.
  const now = Date.parse('2026-09-20T12:00:00Z');
  assert.equal(parseRetryAfterHeader('120', now), 120);
  assert.equal(parseRetryAfterHeader(' 0 ', now), 0);
  assert.equal(parseRetryAfterHeader('Sun, 20 Sep 2026 12:01:30 GMT', now), 90);
  assert.equal(parseRetryAfterHeader('Sun, 20 Sep 2026 11:00:00 GMT', now), 0, 'a past date is 0');
  for (const bad of [null, undefined, '', '  ', '-5', '1.5', '1e3', '0x10', 'soon', '20 Sep 2026', '12abc', '9'.repeat(40)]) {
    assert.equal(parseRetryAfterHeader(bad, now), undefined, `header ${JSON.stringify(bad)}`);
  }

  // ApiError stays constructible the way every existing caller builds it.
  const plain = new ApiError(400, { status: 'error', errorCode: 0, message: 'nope' });
  assert.equal(plain.message, 'nope');
  assert.equal(Object.hasOwn(plain, 'retryAfter'), false);
  assert.equal(Object.hasOwn(plain, 'details'), false);

  // Reseed sends its idempotency key and reports a replay.
  const originalFetch = globalThis.fetch;
  let sent;
  globalThis.fetch = async (url, init) => {
    sent = init.headers;
    return new Response(
      JSON.stringify({
        status: 'success',
        data: {
          workflow: { workflowId: 'wf_take_1' },
          idempotent: true,
          reseed: { cloned_from_run_id: 'wf_source', steps: [] }
        }
      }),
      { status: 200 }
    );
  };
  try {
    const replay = await workflows.reseed('wf_source', { idempotencyKey: 'take-1' });
    assert.equal(sent['Idempotency-Key'], 'take-1');
    assert.equal(replay.idempotent, true);
    assert.equal(replay.workflow.workflowId, 'wf_take_1');
    const fresh = await workflows.reseed('wf_source');
    assert.equal(Object.hasOwn(sent, 'Idempotency-Key'), false, 'no key unless the caller gave one');
    assert.equal(fresh.idempotent, true);
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log('REST error retry-after checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
