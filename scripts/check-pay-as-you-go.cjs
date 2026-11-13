/** Checks the optional pay-as-you-go offer on queued plan projects and the switch request. */

'use strict';

const assert = require('node:assert/strict');

const ProjectsApi = require('../dist/Projects/index.js').default;
const Project = require('../dist/Projects/Project.js').default;
const {
  normalizePayAsYouGoOffer,
  normalizePayAsYouGoSwitchResult
} = require('../dist/Projects/types/PayAsYouGo.js');

class SocketStub {
  constructor() {
    this.listeners = new Map();
    this.sent = [];
  }

  on(event, listener) {
    const listeners = this.listeners.get(event) ?? [];
    listeners.push(listener);
    this.listeners.set(event, listeners);
    return () => this.off(event, listener);
  }

  off(event, listener) {
    this.listeners.set(
      event,
      (this.listeners.get(event) ?? []).filter((candidate) => candidate !== listener)
    );
  }

  emit(event, data) {
    for (const listener of this.listeners.get(event) ?? []) listener(data);
  }

  async send(type, data) {
    this.sent.push({ type, data });
    if (this.sendDelayMs) await new Promise((resolve) => setTimeout(resolve, this.sendDelayMs));
  }

  listenerCount(event) {
    return (this.listeners.get(event) ?? []).length;
  }
}

/** The client and auth objects only need on/emit for these checks. */
class EmitterStub extends SocketStub {}

const logger = { info() {}, warn() {}, error() {}, debug() {} };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function setup() {
  const socket = new SocketStub();
  const client = new EmitterStub();
  client.socket = socket;
  client.logger = logger;
  client.auth = new EmitterStub();
  client.auth.sessionVersion = 1;
  const api = new ProjectsApi({ client, eip712: {} });
  // Keep reconnect recovery quiet in these checks; it is covered elsewhere.
  api.sync = async () => {};
  const project = new Project(
    { type: 'image', numberOfMedia: 1, steps: 4 },
    { id: 'PROJECT-1', logger, api }
  );
  api.projects.push(project);
  const queueEvents = [];
  api.on('queueChanged', (event) => queueEvents.push(event));
  return { socket, client, api, project, queueEvents };
}

function withOffer(socket, rows = [{ jobIndex: 0, waitingReason: queued }]) {
  socket.emit('projectQueue', {
    jobID: 'PROJECT-1',
    waitingReason: rows[0]?.waitingReason ?? null,
    jobWaitingReasons: rows,
    payAsYouGo: offer
  });
}

function settledState(promise) {
  let state = 'pending';
  promise.then(
    () => (state = 'settled'),
    () => (state = 'rejected')
  );
  return () => state;
}

const offer = { available: true, costInSpark: '12.5', coveredByPremiumSpark: true };
const queued = { reason: 'queued', message: 'Queued.' };

async function main() {
  // Normalization accepts only the documented shape.
  assert.deepEqual(normalizePayAsYouGoOffer(offer), offer);
  assert.equal(normalizePayAsYouGoOffer({ ...offer, available: false }), null);
  assert.equal(normalizePayAsYouGoOffer({ ...offer, costInSpark: 12 }), null);
  assert.equal(normalizePayAsYouGoOffer({ ...offer, costInSpark: '-1' }), null);
  assert.deepEqual(normalizePayAsYouGoOffer({ ...offer, coveredByPremiumSpark: 'yes' }), {
    ...offer,
    coveredByPremiumSpark: false
  });
  assert.deepEqual(
    normalizePayAsYouGoSwitchResult('P', { status: 'refused', reason: 'something_new' }),
    {
      projectId: 'P',
      status: 'refused',
      reason: 'not_eligible'
    }
  );

  // A project without the field (older servers, or not offered) reports null.
  {
    const { socket, project, queueEvents } = setup();
    socket.emit('projectQueue', {
      jobID: 'PROJECT-1',
      waitingReason: queued,
      jobWaitingReasons: [{ jobIndex: 0, waitingReason: queued }]
    });
    assert.equal(project.payAsYouGo, null);
    assert.equal(queueEvents.length, 1);
    assert.equal(queueEvents[0].payAsYouGo, null);
  }

  // The offer arrives with the queue state, then clears when the server drops it.
  {
    const { socket, project, queueEvents } = setup();
    const rows = [{ jobIndex: 0, waitingReason: queued }];
    socket.emit('projectQueue', {
      jobID: 'PROJECT-1',
      waitingReason: queued,
      jobWaitingReasons: rows,
      payAsYouGo: offer
    });
    assert.deepEqual(project.payAsYouGo, offer);
    assert.equal(queueEvents.length, 1);
    assert.deepEqual(queueEvents[0].payAsYouGo, offer);
    // Offer-only change still emits queueChanged.
    socket.emit('projectQueue', {
      jobID: 'PROJECT-1',
      waitingReason: queued,
      jobWaitingReasons: rows
    });
    assert.equal(project.payAsYouGo, null);
    assert.equal(queueEvents.length, 2);
    assert.equal(queueEvents[1].payAsYouGo, null);
    // A finished project never keeps an offer.
    socket.emit('projectQueue', {
      jobID: 'PROJECT-1',
      waitingReason: queued,
      jobWaitingReasons: rows,
      payAsYouGo: offer
    });
    project._update({ status: 'completed' });
    assert.equal(project.payAsYouGo, null);
  }

  // The switch sends one request, ignores other projects' replies, and clears the offer.
  {
    const { socket, api, project } = setup();
    socket.emit('projectQueue', {
      jobID: 'PROJECT-1',
      waitingReason: queued,
      jobWaitingReasons: [{ jobIndex: 0, waitingReason: queued }],
      payAsYouGo: offer
    });
    const first = project.switchToPremiumSpark();
    const second = api.switchToPremiumSpark('project-1');
    await Promise.resolve();
    assert.deepEqual(socket.sent, [
      { type: 'switchProjectToPremiumSpark', data: { projectId: 'PROJECT-1' } }
    ]);
    socket.emit('projectPaymentSwitch', { jobID: 'OTHER', status: 'switched' });
    socket.emit('projectPaymentSwitch', {
      jobID: 'PROJECT-1',
      status: 'switched',
      paymentModel: 'paid_spark',
      costInSpark: '12.5'
    });
    const result = await first;
    assert.deepEqual(result, {
      projectId: 'PROJECT-1',
      status: 'switched',
      paymentModel: 'paid_spark',
      costInSpark: '12.5'
    });
    assert.deepEqual(await second, result);
    assert.equal(project.payAsYouGo, null);
    assert.equal(socket.listenerCount('projectPaymentSwitch'), 0);
  }

  // A refusal keeps its reason and charges nothing; no answer resolves as a timeout.
  {
    const { socket, api } = setup();
    const refused = api.switchToPremiumSpark('PROJECT-1');
    await Promise.resolve();
    socket.emit('projectPaymentSwitch', {
      jobID: 'PROJECT-1',
      status: 'refused',
      reason: 'insufficient_premium_spark',
      message: 'Not enough.',
      costInSpark: '12.5'
    });
    assert.deepEqual(await refused, {
      projectId: 'PROJECT-1',
      status: 'refused',
      reason: 'insufficient_premium_spark',
      message: 'Not enough.',
      costInSpark: '12.5'
    });

    const silent = await api.switchToPremiumSpark('PROJECT-1', { timeoutMs: 10 });
    assert.equal(silent.status, 'unknown');
    assert.equal(silent.reason, 'timeout');
    assert.equal(socket.listenerCount('projectPaymentSwitch'), 0);
    // A late reply after the timeout is ignored, and asking again is a new request.
    socket.emit('projectPaymentSwitch', { jobID: 'PROJECT-1', status: 'switched' });
    const again = api.switchToPremiumSpark('PROJECT-1');
    await Promise.resolve();
    assert.equal(socket.sent.length, 3);
    socket.emit('projectPaymentSwitch', { jobID: 'PROJECT-1', status: 'switched' });
    assert.equal((await again).status, 'switched');
  }

  // An unknown server status is an unknown outcome, never a refusal.
  {
    assert.deepEqual(normalizePayAsYouGoSwitchResult('P', { status: 'pending_review' }), {
      projectId: 'P',
      status: 'unknown',
      reason: 'unrecognized_reply'
    });
    const { socket, api, project } = setup();
    withOffer(socket);
    const result = api.switchToPremiumSpark('PROJECT-1');
    await Promise.resolve();
    socket.emit('projectPaymentSwitch', { jobID: 'PROJECT-1', status: 'pending_review' });
    assert.deepEqual(await result, {
      projectId: 'PROJECT-1',
      status: 'unknown',
      reason: 'unrecognized_reply'
    });
    // The outcome is unknown, so the offer is left to the server's next update.
    assert.deepEqual(project.payAsYouGo, offer);
  }

  // The timer starts once the request is sent, not while send() waits.
  {
    const { socket, api } = setup();
    socket.sendDelayMs = 40;
    const result = api.switchToPremiumSpark('PROJECT-1', { timeoutMs: 25 });
    await sleep(50);
    socket.emit('projectPaymentSwitch', { jobID: 'PROJECT-1', status: 'switched' });
    assert.equal((await result).status, 'switched');
  }

  // An invalid timeoutMs falls back to the default instead of timing out at once.
  for (const timeoutMs of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
    const { socket, api } = setup();
    const result = api.switchToPremiumSpark('PROJECT-1', { timeoutMs });
    const state = settledState(result);
    await sleep(15);
    assert.equal(state(), 'pending', `timeoutMs ${timeoutMs} must not settle at once`);
    socket.emit('projectPaymentSwitch', { jobID: 'PROJECT-1', status: 'switched' });
    assert.equal((await result).status, 'switched');
  }

  // A reconnect re-sends once from the new socket, and the timer restarts.
  {
    const { socket, client, api } = setup();
    const result = api.switchToPremiumSpark('PROJECT-1', { timeoutMs: 30 });
    await sleep(0);
    assert.equal(socket.sent.length, 1);
    client.emit('connecting');
    await sleep(20);
    client.emit('connected');
    await sleep(0);
    assert.equal(socket.sent.length, 2);
    assert.deepEqual(socket.sent[1], {
      type: 'switchProjectToPremiumSpark',
      data: { projectId: 'PROJECT-1' }
    });
    // Only one re-send.
    client.emit('connecting');
    client.emit('connected');
    await sleep(0);
    assert.equal(socket.sent.length, 2);
    // 20 ms before the drop plus 20 ms after: past the first 30 ms timer, inside the restarted one.
    await sleep(20);
    const state = settledState(result);
    await Promise.resolve();
    assert.equal(state(), 'pending');
    socket.emit('projectPaymentSwitch', { jobID: 'PROJECT-1', status: 'switched' });
    assert.equal((await result).status, 'switched');
    assert.equal(client.listenerCount('connected'), 1); // only the API's own handler remains
  }

  // A connect that completes the first send is not a reconnect: no duplicate request.
  {
    const { socket, client, api } = setup();
    const result = api.switchToPremiumSpark('PROJECT-1');
    client.emit('connected');
    await sleep(0);
    assert.equal(socket.sent.length, 1);
    socket.emit('projectPaymentSwitch', {
      jobID: 'PROJECT-1',
      status: 'refused',
      reason: 'started'
    });
    assert.equal((await result).reason, 'started');
  }

  // A dropped connection clears the offer and says so in queueChanged.
  {
    const { socket, client, project, queueEvents } = setup();
    withOffer(socket);
    assert.deepEqual(project.payAsYouGo, offer);
    client.emit('connecting');
    assert.equal(project.payAsYouGo, null);
    assert.equal(queueEvents.at(-1).payAsYouGo, null);
    // Offer-only state (no reasons) still emits when the transport drops.
    withOffer(socket, []);
    const before = queueEvents.length;
    client.emit('disconnected');
    assert.equal(project.payAsYouGo, null);
    assert.equal(queueEvents.length, before + 1);
  }

  // A project finishing with only an offer still emits queueChanged.
  {
    const { socket, project, queueEvents } = setup();
    withOffer(socket, []);
    const before = queueEvents.length;
    project._update({ status: 'completed' });
    assert.equal(project.payAsYouGo, null);
    assert.equal(queueEvents.length, before + 1);
    assert.equal(queueEvents.at(-1).payAsYouGo, null);
  }

  // Only 'started' and 'not_eligible' clear the offer locally; the server's next
  // projectQueue update decides every other refusal.
  for (const reason of [
    'no_idle_worker',
    'concurrency_limit',
    'staff_only',
    'unavailable',
    'insufficient_premium_spark',
    'insufficient_funds',
    'payment_failed'
  ]) {
    const { socket, api, project } = setup();
    withOffer(socket);
    const result = api.switchToPremiumSpark('PROJECT-1');
    await Promise.resolve();
    socket.emit('projectPaymentSwitch', { jobID: 'PROJECT-1', status: 'refused', reason });
    assert.equal((await result).reason, reason);
    assert.deepEqual(project.payAsYouGo, offer, `${reason} must keep the offer`);
  }
  for (const reason of ['started', 'not_eligible']) {
    const { socket, api, project, queueEvents } = setup();
    withOffer(socket);
    const before = queueEvents.length;
    const result = api.switchToPremiumSpark('PROJECT-1');
    await Promise.resolve();
    socket.emit('projectPaymentSwitch', { jobID: 'PROJECT-1', status: 'refused', reason });
    assert.equal((await result).reason, reason);
    assert.equal(project.payAsYouGo, null, `${reason} must clear the offer`);
    assert.equal(queueEvents.length, before + 1);
  }

  // not_found never proves nothing was charged: it is always unknown.
  {
    assert.deepEqual(
      normalizePayAsYouGoSwitchResult('P', {
        status: 'refused',
        reason: 'not_found',
        message: 'This creation is no longer waiting.'
      }),
      {
        projectId: 'P',
        status: 'unknown',
        reason: 'not_found',
        message: 'This creation is no longer waiting.'
      }
    );
    const { socket, api, project } = setup();
    withOffer(socket);
    const direct = api.switchToPremiumSpark('PROJECT-1');
    await Promise.resolve();
    socket.emit('projectPaymentSwitch', {
      jobID: 'PROJECT-1',
      status: 'refused',
      reason: 'not_found'
    });
    const result = await direct;
    assert.equal(result.status, 'unknown');
    assert.equal(result.reason, 'not_found');
    // Unknown leaves the offer to the server.
    assert.deepEqual(project.payAsYouGo, offer);
  }

  // The first send switched, its reply went to the dropped socket, the project
  // finished, and the re-send after the reconnect finds nothing: unknown, not refused.
  {
    const { socket, client, api } = setup();
    const result = api.switchToPremiumSpark('PROJECT-1', { timeoutMs: 1000 });
    await sleep(2);
    client.emit('connecting');
    client.emit('connected');
    await sleep(2);
    assert.equal(socket.sent.length, 2);
    socket.emit('projectPaymentSwitch', {
      jobID: 'PROJECT-1',
      status: 'refused',
      reason: 'not_found',
      message: 'This creation is no longer waiting.'
    });
    const outcome = await result;
    assert.equal(outcome.status, 'unknown');
    assert.equal(outcome.reason, 'not_found');
  }

  // A session change settles a pending switch as unknown, never as a refusal.
  {
    const { client, api, socket } = setup();
    const result = api.switchToPremiumSpark('project-1');
    await sleep(0);
    client.auth.sessionVersion = 2;
    client.auth.emit('sessionChanged');
    assert.deepEqual(await result, {
      projectId: 'project-1',
      status: 'unknown',
      reason: 'session_changed'
    });
    assert.equal(socket.listenerCount('projectPaymentSwitch'), 0);
  }

  // A request that certainly never left the client is the SDK's own `not_sent`
  // refusal, never the server's `unavailable`, and it keeps the offer.
  {
    const { socket, api, project } = setup();
    withOffer(socket);
    socket.send = async () => {
      throw new Error('socket closed');
    };
    assert.deepEqual(await api.switchToPremiumSpark('PROJECT-1'), {
      projectId: 'PROJECT-1',
      status: 'refused',
      reason: 'not_sent'
    });
    assert.deepEqual(project.payAsYouGo, offer);
    assert.equal(socket.listenerCount('projectPaymentSwitch'), 0);
  }

  console.log('pay-as-you-go checks passed');
}

// Each Project keeps a liveness interval; exit explicitly once the checks finish.
main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  }
);
