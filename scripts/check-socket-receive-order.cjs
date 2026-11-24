'use strict';

// Browser binary frames use asynchronous Blob.text(). Exercise the compiled
// receive handler and actual ChatApi, including its non-streaming writer path.
const assert = require('node:assert/strict');
require('../dist/index.js');
const WebSocketClient = require('../dist/ApiClient/WebSocketClient/index.js').default;
const ChatApi = require('../dist/Chat/index.js').default;
const isNodejs = require('../dist/lib/isNodejs.js');
const tick = () => new Promise((resolve) => setImmediate(resolve));
const frame = (type, data) =>
  JSON.stringify({
    type,
    data: Buffer.from(JSON.stringify(data), 'utf8').toString('base64')
  });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

function harness() {
  const errors = [];
  const logger = { debug() {}, info() {}, warn() {}, error: (...args) => errors.push(args) };
  const socket = new WebSocketClient('http://localhost', {}, 'LOCAL-ORDER-TEST', 'fast', logger);
  socket.socket = { readyState: 1 };
  const sent = [];
  socket.send = async (type, data) => {
    sent.push({ type, data });
  };
  const chat = new ChatApi({
    client: {
      socket,
      logger,
      appId: 'LOCAL-ORDER-TEST',
      on() {
        return () => {};
      }
    },
    eip712: {}
  });
  return { socket, chat, sent, errors };
}

function enqueue(socket, type, data, source = socket.socket) {
  const read = deferred();
  socket.handleMessage({ target: source, data: { text: () => read.promise } });
  return {
    release: () => read.resolve(frame(type, data)),
    fail: () => read.reject(new Error('synthetic read failure'))
  };
}

async function main() {
  const original = isNodejs.default;
  try {
    isNodejs.default = false;
    for (const streaming of [false, true]) {
      const { socket, chat, sent } = harness();
      const completion = chat.completions.create({
        model: 'test-model',
        messages: [{ role: 'user', content: 'A robot walks.' }],
        stream: streaming
      });
      await tick();
      const jobID = sent[0].data.jobID;
      const stream = streaming ? await completion : null;
      const received = [];
      socket.on('jobTokens', (data) => received.push(data.content));
      const chunks = ['The robot walk', 's forward', '.'];
      const reads = chunks.map((content) => enqueue(socket, 'jobTokens', { jobID, content }));
      const terminal = enqueue(socket, 'llmJobResult', { jobID, timeTaken: 1 });
      // Later decoding and the completion become ready before the first token.
      terminal.release();
      reads[2].release();
      reads[1].release();
      await tick();
      assert.deepEqual(received, [], 'later frames cannot pass the unresolved first frame');
      reads[0].release();
      let result;
      if (streaming) {
        let text = '';
        for await (const chunk of stream) text += chunk.content;
        assert.equal(text, chunks.join(''));
        result = stream.finalResult;
      } else result = await completion;
      assert.equal(result.content, 'The robot walks forward.');
      assert.deepEqual(received, chunks);
    }

    // Failure frames are also delivered after preceding token frames.
    {
      const { socket, chat, sent } = harness();
      const completion = chat.completions.create({
        model: 'test-model',
        messages: [{ role: 'user', content: 'A robot walks.' }],
        stream: false
      });
      const rejected = assert.rejects(completion, /synthetic failure/);
      await tick();
      const jobID = sent[0].data.jobID;
      const delivered = [];
      socket.on('jobTokens', () => delivered.push('token'));
      socket.on('llmJobError', () => delivered.push('error'));
      const token = enqueue(socket, 'jobTokens', { jobID, content: 'The robot' });
      const error = enqueue(socket, 'llmJobError', { jobID, error: 'synthetic failure' });
      error.release();
      await tick();
      assert.deepEqual(delivered, []);
      token.release();
      await rejected;
      assert.deepEqual(delivered, ['token', 'error']);
    }

    // Broken decoding or JSON parsing cannot stall subsequent frames.
    for (const failure of ['read', 'json']) {
      const { socket, errors } = harness();
      const received = [];
      socket.on('jobTokens', (data) => received.push(data.content));
      const bad = deferred();
      socket.handleMessage({ target: socket.socket, data: { text: () => bad.promise } });
      const good = enqueue(socket, 'jobTokens', { jobID: 'CHECK', content: '¡Sigue! 前進。' });
      await tick();
      if (failure === 'read') bad.reject(new Error('synthetic read failure'));
      else bad.resolve('{broken');
      good.release();
      await tick();
      assert.deepEqual(received, ['¡Sigue! 前進。']);
      assert.equal(errors.length, 1);
    }

    // A later decode failure is handled immediately while earlier work waits;
    // a throwing listener also must not poison the ordered delivery queue.
    {
      const { socket, errors } = harness();
      const received = [];
      socket.on('jobTokens', (data) => {
        if (data.content === 'listener failure') throw new Error('synthetic listener failure');
        received.push(data.content);
      });
      const first = enqueue(socket, 'jobTokens', { jobID: 'CHECK', content: 'first' });
      const failed = enqueue(socket, 'jobTokens', { jobID: 'CHECK', content: 'unused' });
      const throws = enqueue(socket, 'jobTokens', { jobID: 'CHECK', content: 'listener failure' });
      const last = enqueue(socket, 'jobTokens', { jobID: 'CHECK', content: 'last' });
      await tick();
      failed.fail();
      throws.release();
      last.release();
      await tick();
      assert.deepEqual(received, []);
      assert.equal(errors.length, 0, 'later decode failures are reported in arrival order');
      first.release();
      await tick();
      assert.deepEqual(received, ['first', 'last']);
      assert.equal(errors.length, 2);
    }

    // A pending old decode must neither delay nor leak into a new connection.
    {
      const { socket } = harness();
      const received = [];
      socket.on('jobTokens', (data) => received.push(data.content));
      const oldSource = socket.socket;
      const old = enqueue(socket, 'jobTokens', { jobID: 'OLD', content: 'old' });
      await tick();
      socket.socket = { readyState: 1 };
      const current = enqueue(socket, 'jobTokens', { jobID: 'NEW', content: 'new' });
      current.release();
      await tick();
      assert.deepEqual(received, ['new']);
      old.release();
      enqueue(socket, 'jobTokens', { jobID: 'OLD', content: 'stale' }, oldSource).release();
      await tick();
      assert.deepEqual(received, ['new']);
      const closing = enqueue(socket, 'jobTokens', { jobID: 'NEW', content: 'closed' });
      await tick();
      socket.socket = null;
      closing.release();
      await tick();
      assert.deepEqual(received, ['new']);
    }

    // Node Buffer input retains its existing UTF-8 decoding and ordered events.
    isNodejs.default = true;
    {
      const { socket } = harness();
      const received = [];
      socket.on('jobTokens', (data) => received.push(data.content));
      for (const content of ['one ', '¡dos! ', '三']) {
        socket.handleMessage({
          target: socket.socket,
          data: Buffer.from(frame('jobTokens', { jobID: 'NODE', content }))
        });
      }
      await tick();
      assert.deepEqual(received, ['one ', '¡dos! ', '三']);
    }
    console.log(
      'Socket receive ordering checks passed (streaming/non-streaming, decode errors, reconnect, Node).'
    );
  } finally {
    isNodejs.default = original;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
