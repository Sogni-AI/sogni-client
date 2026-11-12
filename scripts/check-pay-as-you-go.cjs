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
  }

  listenerCount(event) {
    return (this.listeners.get(event) ?? []).length;
  }
}

const logger = { info() {}, warn() {}, error() {}, debug() {} };

function setup() {
  const socket = new SocketStub();
  const client = { socket, on: () => () => {}, logger };
  const api = new ProjectsApi({ client, eip712: {} });
  const project = new Project(
    { type: 'image', numberOfMedia: 1, steps: 4 },
    { id: 'PROJECT-1', logger, api }
  );
  api.projects.push(project);
  const queueEvents = [];
  api.on('queueChanged', (event) => queueEvents.push(event));
  return { socket, api, project, queueEvents };
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
    assert.equal(silent.status, 'refused');
    assert.equal(silent.reason, 'timeout');
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
