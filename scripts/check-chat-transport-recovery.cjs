/**
 * Regression tests for socket LLM streams across a transport drop.
 *
 * A socket deploy refunds every in-flight LLM job and closes the socket; the
 * `llmJobError` it sends first is best-effort. A plain network blip is
 * different: the server keeps the job for 30 s and rebinds it when the same
 * app-id reconnects. The SDK must never leave a stream waiting forever, must
 * keep a stream the server rebound, and must mark connection failures as
 * retryable so apps can re-issue the request.
 *
 * Runs against compiled `dist/` output, like the sibling check-* scripts.
 */

'use strict';

const assert = require('node:assert/strict');

const ChatApi = require('../dist/Chat/index.js').default;
const { ChatJobError, isRetryableChatError } = require('../dist/Chat/ChatJobError.js');

const SILENT_LOGGER = { info() {}, warn() {}, error() {}, debug() {} };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class Emitter {
  constructor() {
    this.listeners = new Map();
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
}

function makeHarness({ graceMs = 60, sendError = null } = {}) {
  const socket = new Emitter();
  socket.sent = [];
  socket.send = async (type, data) => {
    if (sendError) throw sendError;
    socket.sent.push({ type, data });
  };
  const client = new Emitter();
  client.socket = socket;
  client.appId = 'app-under-test';
  client.logger = SILENT_LOGGER;
  const chat = new ChatApi({ client, eip712: {} });
  chat._transportTuning = { graceMs };
  return { chat, socket, client };
}

async function openStream(chat, socket) {
  const stream = await chat.completions.create({
    model: 'qwen',
    messages: [{ role: 'user', content: 'hello' }],
    stream: true
  });
  const jobID = socket.sent.at(-1).data.jobID;
  return { stream, jobID };
}

async function drain(stream) {
  let content = '';
  for await (const chunk of stream) content += chunk.content;
  return content;
}

async function main() {
  // 1. Socket restarted: the reconnect handshake does not list the job, so the
  //    stream fails at once with a retryable error instead of hanging.
  {
    const { chat, socket, client } = makeHarness({ graceMs: 10_000 });
    const { stream, jobID } = await openStream(chat, socket);
    socket.emit('jobTokens', { jobID, content: 'partial ' });
    const pending = drain(stream);
    client.emit('connecting', { network: 'fast' });
    client.emit('connected', { network: 'fast' });
    socket.emit('authenticated', { clientType: 'artist', activeLLMJobIDs: [] });
    await assert.rejects(pending, (error) => {
      assert.ok(error instanceof ChatJobError);
      assert.equal(error.errorType, 'transport_lost');
      assert.equal(error.retryable, true);
      assert.equal(isRetryableChatError(error), true);
      return true;
    });
    assert.equal(chat.transportGraceTimer, null, 'no timer left behind');
  }

  // 2. Network blip inside the server's grace: the job is listed, so the stream
  //    keeps going and completes normally.
  {
    const { chat, socket, client } = makeHarness({ graceMs: 30 });
    const { stream, jobID } = await openStream(chat, socket);
    const pending = drain(stream);
    socket.emit('jobTokens', { jobID, content: 'a' });
    client.emit('connecting', { network: 'fast' });
    client.emit('connected', { network: 'fast' });
    socket.emit('authenticated', { clientType: 'artist', activeLLMJobIDs: [jobID.toLowerCase()] });
    await sleep(60);
    socket.emit('jobTokens', { jobID, content: 'b' });
    socket.emit('llmJobResult', { jobID, timeTaken: 1 });
    assert.equal(await pending, 'ab', 'rebound stream delivers the rest');
  }

  // 3. Older server (no activeLLMJobIDs): the stream is failed when the grace
  //    window passes in silence...
  {
    const { chat, socket, client } = makeHarness({ graceMs: 40 });
    const { stream } = await openStream(chat, socket);
    const pending = drain(stream);
    client.emit('connecting', { network: 'fast' });
    client.emit('connected', { network: 'fast' });
    socket.emit('authenticated', { clientType: 'artist' });
    await assert.rejects(pending, (error) => error.errorType === 'transport_lost');
  }

  // 3b. ...but a frame from the job inside the window proves it survived.
  {
    const { chat, socket, client } = makeHarness({ graceMs: 40 });
    const { stream, jobID } = await openStream(chat, socket);
    const pending = drain(stream);
    client.emit('connecting', { network: 'fast' });
    client.emit('connected', { network: 'fast' });
    socket.emit('jobTokens', { jobID, content: 'still here' });
    await sleep(80);
    socket.emit('llmJobResult', { jobID, timeTaken: 1 });
    assert.equal(await pending, 'still here');
  }

  // 4. The server's own shutdown refund arrives: retryable server_restarting.
  {
    const { chat, socket } = makeHarness();
    const { stream, jobID } = await openStream(chat, socket);
    const pending = drain(stream);
    socket.emit('llmJobError', {
      jobID,
      error: 'server_restarting',
      error_message: 'Server is restarting; this LLM request was refunded.'
    });
    await assert.rejects(pending, (error) => error.retryable === true);
  }

  // 5. A terminal close (e.g. signed out) fails open streams immediately.
  {
    const { chat, socket, client } = makeHarness({ graceMs: 10_000 });
    const { stream } = await openStream(chat, socket);
    const pending = drain(stream);
    client.emit('disconnected', { code: 4021, reason: 'auth' });
    await assert.rejects(pending, (error) => error.errorType === 'transport_lost');
  }

  // 6. A request that could not be sent at all is a retryable failure.
  {
    const { chat } = makeHarness({ sendError: new Error('WebSocket connection timeout') });
    await assert.rejects(
      chat.completions.create({
        model: 'qwen',
        messages: [{ role: 'user', content: 'x' }],
        stream: true
      }),
      (error) => error.errorType === 'transport_lost' && error.retryable === true
    );
    assert.equal(chat.activeStreams.size, 0, 'no orphaned stream');
  }

  // 7. Non-streaming requests reject the same way.
  {
    const { chat, socket, client } = makeHarness({ graceMs: 10_000 });
    const pending = chat.completions.create({
      model: 'qwen',
      messages: [{ role: 'user', content: 'x' }]
    });
    await sleep(5);
    client.emit('connecting', { network: 'fast' });
    socket.emit('authenticated', { clientType: 'artist', activeLLMJobIDs: [] });
    await assert.rejects(pending, (error) => error.retryable === true);
  }

  // 8. Ordinary failures are not retryable.
  assert.equal(
    isRetryableChatError(new ChatJobError('nope', { errorType: 'invalid_request' })),
    false
  );
  assert.equal(isRetryableChatError(new Error('plain')), false);

  console.log('check-chat-transport-recovery: ALL TESTS PASSED');
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
