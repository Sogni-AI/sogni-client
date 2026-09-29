#!/usr/bin/env node
/**
 * Transport checks for `sogni.chat.runs.confirmCost()`
 * (`POST /v1/chat/runs/:id/confirm-cost`).
 *
 * The API requires `acceptedCostPreview` for `decision: 'confirm'` and
 * compares it with the preview it issued, so the SDK must forward the
 * caller's preview unchanged, send `idempotencyKey` as `Idempotency-Key`,
 * keep cancel working without a preview, and never read the current preview
 * and accept it on the caller's behalf.
 *
 * Run: npm run test:chat-run-cost-confirmation
 */
const assert = require('node:assert/strict');
const ChatApi = require('../dist/Chat/index.js').default;

function makeChatApi() {
  const listeners = { on() {}, off() {} };
  const client = {
    auth: { ...listeners, isAuthenticated: true, authenticateRequest: async (init) => init ?? {} },
    socket: { ...listeners, isConnected: false, supernetType: 'fast', async send() {} },
    rest: { baseUrl: 'https://api.example.test' },
    appId: 'cost-confirmation-test',
    appSource: 'sdk-test',
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    ...listeners
  };
  return new ChatApi({ client, eip712: {} });
}

const PREVIEW = Object.freeze({
  totalEstimatedCapacityUnits: 42.5,
  tokenType: 'spark',
  validityUntil: '2026-09-16T20:05:00.000Z',
  perToolBreakdown: [{ toolCallId: 'call_1', toolName: 'generate_video', capacityUnits: 42.5 }]
});

const realFetch = globalThis.fetch;
let calls = [];
let nextResponse;

function respondWith(status, payload) {
  nextResponse = { status, payload };
}

globalThis.fetch = async (url, init = {}) => {
  calls.push({
    url: String(url),
    method: init.method ?? 'GET',
    headers: { ...(init.headers ?? {}) },
    body: init.body === undefined ? undefined : JSON.parse(init.body)
  });
  const { status, payload } = nextResponse;
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
};

async function check(name, fn) {
  calls = [];
  respondWith(200, { status: 'success', data: { run: { runId: 'run / 1', status: 'running' } } });
  await fn();
  console.log(`  ok - ${name}`);
}

async function run() {
  const api = makeChatApi();

  await check('confirm forwards acceptedCostPreview and Idempotency-Key', async () => {
    const run = await api.runs.confirmCost('run / 1', {
      toolCallId: 'call_1',
      decision: 'confirm',
      acceptedCostPreview: PREVIEW,
      overrides: { duration: 5 },
      reason: 'approved in modal',
      idempotencyKey: 'confirm-call_1'
    });
    assert.equal(run.status, 'running');
    assert.equal(calls.length, 1, 'confirm must be a single POST with no preview read first');
    const [call] = calls;
    assert.equal(call.method, 'POST');
    assert.equal(call.url, 'https://api.example.test/v1/chat/runs/run%20%2F%201/confirm-cost');
    assert.equal(call.headers['Content-Type'], 'application/json');
    assert.equal(call.headers['Idempotency-Key'], 'confirm-call_1');
    assert.deepEqual(call.body, {
      tool_call_id: 'call_1',
      decision: 'confirm',
      acceptedCostPreview: PREVIEW,
      overrides: { duration: 5 },
      reason: 'approved in modal'
    });
    assert.ok(!('idempotencyKey' in call.body), 'idempotency key travels as a header only');
    assert.ok(
      !('accepted_cost_preview' in call.body),
      'preview uses the documented camelCase field'
    );
  });

  await check('confirm sends the preview exactly as received', async () => {
    const received = JSON.parse(
      JSON.stringify({
        ...PREVIEW,
        totalEstimatedCapacityUnits: 7,
        extraServerField: { kept: true }
      })
    );
    await api.runs.confirmCost('run_2', {
      toolCallId: 'call_2',
      decision: 'confirm',
      acceptedCostPreview: received
    });
    assert.deepEqual(calls[0].body.acceptedCostPreview, received);
    assert.ok(!('Idempotency-Key' in calls[0].headers), 'no key header unless provided');
  });

  await check('cancel works without a preview and keeps the legacy body', async () => {
    await api.runs.confirmCost('run_3', { toolCallId: 'call_3', decision: 'cancel' });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].body, { tool_call_id: 'call_3', decision: 'cancel' });
    assert.deepEqual(calls[0].headers, { 'Content-Type': 'application/json' });
  });

  await check('legacy confirm call is not auto-filled with the current preview', async () => {
    respondWith(400, {
      status: 'error',
      message: 'acceptedCostPreview is required for decision="confirm"'
    });
    await assert.rejects(
      api.runs.confirmCost('run_4', { toolCallId: 'call_4', decision: 'confirm' }),
      (error) => {
        assert.equal(error.status, 400);
        assert.match(error.message, /acceptedCostPreview is required/);
        return true;
      }
    );
    assert.equal(calls.length, 1, 'the SDK must not GET the run to find a preview');
    assert.deepEqual(calls[0].body, { tool_call_id: 'call_4', decision: 'confirm' });
  });

  await check('stale preview conflicts surface the server status and message', async () => {
    respondWith(409, {
      status: 'error',
      message: 'Chat run cost-approval preview has expired. Refresh the preview before confirming.'
    });
    await assert.rejects(
      api.runs.confirmCost('run_5', {
        toolCallId: 'call_5',
        decision: 'confirm',
        acceptedCostPreview: PREVIEW
      }),
      (error) => {
        assert.equal(error.status, 409);
        assert.match(error.message, /Refresh the preview/);
        return true;
      }
    );
  });

  console.log('Chat run cost confirmation checks passed.');
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    globalThis.fetch = realFetch;
  });
