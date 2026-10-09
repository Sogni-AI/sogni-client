#!/usr/bin/env node
/**
 * Transport checks for `sogni.worlds.builds.*` (`/v1/world-builds`).
 *
 * The SDK must send the start body as the API reads it, carry the
 * idempotency key as `Idempotency-Key`, address every run by its encoded id,
 * forward the quote decision and the review verdict unchanged, surface the
 * API's own error message and retry wait, and parse the SSE stream with
 * `Last-Event-ID` replay while skipping `run_status` frames.
 *
 * Run: npm run test:world-builds
 */
const assert = require('node:assert/strict');
const WorldsApi = require('../dist/Worlds/index.js').default;

function makeWorldsApi() {
  const listeners = { on() {}, off() {} };
  const client = {
    auth: { ...listeners, isAuthenticated: true, authenticateRequest: async (init) => ({ ...(init ?? {}), headers: { ...(init?.headers ?? {}), Authorization: 'Bearer session' } }) },
    socket: { ...listeners, isConnected: false, supernetType: 'fast', async send() {} },
    rest: { baseUrl: 'https://api.example.test' },
    appId: 'world-builds-test',
    appSource: 'sogni-world',
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    ...listeners
  };
  return new WorldsApi({ client, eip712: {} });
}

const realFetch = globalThis.fetch;
let calls = [];
let nextResponse;
function respondWith(status, payload, headers = {}) {
  nextResponse = { status, payload, headers };
}
globalThis.fetch = async (url, init = {}) => {
  calls.push({
    url: String(url),
    method: init.method ?? 'GET',
    headers: { ...(init.headers ?? {}) },
    body: init.body === undefined ? undefined : JSON.parse(init.body)
  });
  const { status, payload, headers } = nextResponse;
  if (payload instanceof ReadableStream) return new Response(payload, { status, headers: { 'Content-Type': 'text/event-stream', ...headers } });
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json', ...headers } });
};

async function check(name, fn) {
  calls = [];
  respondWith(200, { status: 'success', data: { run: { runId: 'wbuild / 1', status: 'queued' } } });
  await fn();
  console.log(`  ok - ${name}`);
}

async function run() {
  const api = makeWorldsApi();

  await check('start sends the scene, the hotspots, billing and look as the API reads them, with Idempotency-Key', async () => {
    respondWith(202, { status: 'success', data: { run: { runId: 'wbuild_1', status: 'queued' }, idempotent: false } });
    const run = await api.builds.start({
      worldId: 'w', nodeId: 'n', look: 'painted', audience: 'teen', tokenType: 'spark', billingMode: 'subscription', idempotencyKey: 'once',
      hotspots: [{ kind: 'path', object: 'the door', action: { verb: 'Open', subject: 'the door', intent: 'Step through' }, leadsTo: 'Garden', duration: 5.17, point: { x: 0.4, y: 0.6 } }]
    });
    assert.equal(run.runId, 'wbuild_1');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.example.test/v1/world-builds');
    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[0].headers['Idempotency-Key'], 'once');
    assert.equal(calls[0].headers.Authorization, 'Bearer session');
    assert.deepEqual(calls[0].body, {
      worldId: 'w', nodeId: 'n', look: 'painted', audience: 'teen', tokenType: 'spark', billingMode: 'subscription',
      hotspots: [{ kind: 'path', object: 'the door', action: { verb: 'Open', subject: 'the door', intent: 'Step through' }, leadsTo: 'Garden', duration: 5.17, point: { x: 0.4, y: 0.6 } }]
    });
  });

  await check('list, get and events address the run by its encoded id and query', async () => {
    respondWith(200, { status: 'success', data: { runs: [{ runId: 'a' }] } });
    assert.deepEqual(await api.builds.list({ worldId: 'w', limit: 5 }), [{ runId: 'a' }]);
    assert.equal(calls[0].url, 'https://api.example.test/v1/world-builds?worldId=w&limit=5');
    respondWith(200, { status: 'success', data: { run: { runId: 'wbuild / 1' } } });
    await api.builds.get('wbuild / 1');
    assert.equal(calls[1].url, 'https://api.example.test/v1/world-builds/wbuild%20%2F%201');
    respondWith(200, { status: 'success', data: { events: [{ sequence: 3, type: 'task_step', at: 'now' }] } });
    const events = await api.builds.events('wbuild_1', 2);
    assert.deepEqual(events, [{ sequence: 3, type: 'task_step', at: 'now' }]);
    assert.equal(calls[2].url, 'https://api.example.test/v1/world-builds/wbuild_1/events?after=2');
  });

  await check('confirmCost, review and cancel forward the decision bodies unchanged', async () => {
    await api.builds.confirmCost('wbuild_1', { decision: 'requote' });
    assert.equal(calls[0].url, 'https://api.example.test/v1/world-builds/wbuild_1/confirm-cost');
    assert.deepEqual(calls[0].body, { decision: 'requote' });
    await api.builds.review('wbuild_1', { taskId: 'door', decision: 'rejected', note: 'too dark' });
    assert.equal(calls[1].url, 'https://api.example.test/v1/world-builds/wbuild_1/review');
    assert.deepEqual(calls[1].body, { taskId: 'door', decision: 'rejected', note: 'too dark' });
    await api.builds.review('wbuild_1', { taskId: 'door', decision: 'approved' });
    assert.deepEqual(calls[2].body, { taskId: 'door', decision: 'approved' });
    await api.builds.cancel('wbuild_1', 'changed my mind');
    assert.deepEqual(calls[3].body, { reason: 'changed my mind' });
    await api.builds.cancel('wbuild_1');
    assert.deepEqual(calls[4].body, {});
  });

  await check('the API\'s own message, status and retry wait survive an error', async () => {
    respondWith(409, { status: 'error', message: 'That quote has expired. Ask for a fresh one with decision "requote".' });
    await assert.rejects(api.builds.confirmCost('wbuild_1', { decision: 'confirm' }), (error) => {
      assert.equal(error.status, 409);
      assert.match(error.message, /quote has expired/);
      return true;
    });
    respondWith(429, { status: 'error', message: 'Wait' }, { 'Retry-After': '17' });
    await assert.rejects(api.builds.start({ worldId: 'w', nodeId: 'n', hotspots: [] }), (error) => {
      assert.equal(error.status, 429);
      assert.equal(error.retryAfter, 17);
      return true;
    });
  });

  await check('streamEvents replays from Last-Event-ID, yields events in order and skips run_status frames', async () => {
    const frames = [
      'id: 1\nevent: run_started\ndata: {"sequence":1,"type":"run_started","at":"t"}\n\n',
      ': keep-alive\n\n',
      'event: run_status\ndata: {"runId":"wbuild_1","status":"running"}\n\n',
      'id: 2\nevent: task_ready\ndata: {"sequence":2,"type":"task_ready","at":"t","payload":{"taskId":"door"}}\n\n'
    ];
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        for (const frame of frames) controller.enqueue(encoder.encode(frame));
        controller.close();
      }
    });
    respondWith(200, stream);
    const received = [];
    for await (const event of api.builds.streamEvents('wbuild_1', { lastEventId: 0 })) received.push(event);
    assert.equal(calls[0].url, 'https://api.example.test/v1/world-builds/wbuild_1/events/stream');
    assert.equal(calls[0].headers['Last-Event-ID'], '0');
    assert.equal(calls[0].headers.Accept, 'text/event-stream');
    assert.deepEqual(received.map((event) => [event.sequence, event.type]), [[1, 'run_started'], [2, 'task_ready']]);
  });
}

run()
  .then(() => { globalThis.fetch = realFetch; console.log('world-builds transport checks passed'); })
  .catch((error) => { globalThis.fetch = realFetch; console.error(error); process.exit(1); });
