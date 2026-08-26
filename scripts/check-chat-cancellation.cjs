const assert = require('node:assert/strict');

const ChatApi = require('../dist/Chat/index.js').default;

class StubSocket {
  constructor() {
    this.sent = [];
  }

  on() {
    return () => {};
  }

  async send(type, data) {
    this.sent.push({ type, data });
  }
}

class StubClient {
  constructor() {
    this.appSource = 'chat-cancellation-test';
    this.attribution = {};
    this.socket = new StubSocket();
    this.logger = {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {}
    };
  }

  on() {
    return () => {};
  }
}

function makeChat() {
  const client = new StubClient();
  return { client, chat: new ChatApi({ client, eip712: {} }) };
}

async function nextTurn() {
  await new Promise((resolve) => setImmediate(resolve));
}

async function checkPreAbortedRequest() {
  const { client, chat } = makeChat();
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    chat.completions.create({
      model: 'test-model',
      messages: [{ role: 'user', content: 'hello' }],
      signal: controller.signal
    }),
    { name: 'AbortError' }
  );
  assert.deepEqual(client.socket.sent, []);
}

async function checkStreamingAbort() {
  const { client, chat } = makeChat();
  const controller = new AbortController();
  const stream = await chat.completions.create({
    model: 'test-model',
    messages: [{ role: 'user', content: 'hello' }],
    stream: true,
    signal: controller.signal
  });
  const request = client.socket.sent[0];
  assert.equal(request.type, 'llmJobRequest');

  controller.abort();
  await nextTurn();

  assert.equal(client.socket.sent[1].type, 'llmJobCancel');
  assert.equal(client.socket.sent[1].data.jobID, request.data.jobID);
  await assert.rejects(stream[Symbol.asyncIterator]().next(), { name: 'AbortError' });
}

async function checkNonStreamingAbort() {
  const { client, chat } = makeChat();
  const controller = new AbortController();
  const completion = chat.completions.create({
    model: 'test-model',
    messages: [{ role: 'user', content: 'hello' }],
    signal: controller.signal
  });
  await nextTurn();
  const request = client.socket.sent[0];
  assert.equal(request.type, 'llmJobRequest');

  controller.abort();
  await assert.rejects(completion, { name: 'AbortError' });
  assert.equal(client.socket.sent[1].type, 'llmJobCancel');
  assert.equal(client.socket.sent[1].data.jobID, request.data.jobID);
}

async function checkCompletedStreamRemovesAbortListener() {
  const { client, chat } = makeChat();
  const controller = new AbortController();
  await chat.completions.create({
    model: 'test-model',
    messages: [{ role: 'user', content: 'hello' }],
    stream: true,
    signal: controller.signal
  });
  const request = client.socket.sent[0];

  chat.handleJobResult({
    jobID: request.data.jobID,
    content: 'done',
    role: 'assistant',
    finishReason: 'stop',
    timeTaken: 1,
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
  });
  controller.abort();
  await nextTurn();

  assert.equal(client.socket.sent.length, 1);
}

async function main() {
  await checkPreAbortedRequest();
  await checkStreamingAbort();
  await checkNonStreamingAbort();
  await checkCompletedStreamRemovesAbortListener();
  console.log('Chat cancellation checks passed.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
