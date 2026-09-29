/**
 * Regression checks for the message a non-2xx REST response turns into.
 * Runs against compiled output so it also checks the published API shape.
 */

'use strict';

const assert = require('node:assert/strict');
// ApiClient first: RestClient imports ApiError from it, and ApiClient's WebSocketClient extends RestClient.
const { ApiError } = require('../dist/ApiClient/index.js');
const RestClient = require('../dist/lib/RestClient.js').default;

const HOLD_MESSAGE = 'MiniMax H3 Latent Upscaler (Community) will be available soon.';

const auth = {
  isAuthenticated: false,
  clear() {},
  async authenticateRequest(init) {
    return init;
  }
};
const logger = { info() {}, warn() {}, error() {}, debug() {} };

async function errorFor(status, statusText, body) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(body, { status, statusText });
  try {
    const client = new RestClient('https://socket.example.test', auth, logger);
    await client.get('/api/v1/job-video/estimate/spark/minimax-h3/672/384/124/24/4/1');
  } catch (error) {
    return error;
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.fail('a non-2xx response must throw');
}

async function main() {
  // The socket refuses a held model with a plain-text body. HTTP/1.1 carries the
  // "Bad Request" reason phrase, which must not replace the server's explanation.
  let error = await errorFor(400, 'Bad Request', HOLD_MESSAGE);
  assert.ok(error instanceof ApiError);
  assert.equal(error.status, 400);
  assert.equal(error.message, HOLD_MESSAGE);
  assert.equal(error.payload.message, HOLD_MESSAGE);
  assert.equal(error.payload.errorCode, 400);

  // HTTP/2 has no reason phrase; the body is still the message.
  error = await errorFor(400, '', `${HOLD_MESSAGE}\n`);
  assert.equal(error.message, HOLD_MESSAGE);

  // A JSON object body keeps its own shape and message.
  error = await errorFor(
    422,
    'Unprocessable Entity',
    JSON.stringify({ status: 'error', message: 'Width is too small', errorCode: 4001 })
  );
  assert.equal(error.message, 'Width is too small');
  assert.equal(error.payload.errorCode, 4001);

  // An empty body falls back to the reason phrase, then to the status code.
  error = await errorFor(503, 'Service Unavailable', '');
  assert.equal(error.message, 'Service Unavailable');
  error = await errorFor(503, '', '');
  assert.equal(error.message, 'HTTP 503');

  // A gateway HTML page is labelled by its status with a short excerpt, not dumped whole.
  const html = `<html><head><title>502 Bad Gateway</title></head><body>${'x'.repeat(1000)}</body></html>`;
  error = await errorFor(502, 'Bad Gateway', html);
  assert.ok(error.message.startsWith('Bad Gateway: <html><head><title>502 Bad Gateway'));
  assert.equal(error.message.length, 'Bad Gateway: '.length + 200);

  // A long plain-text body is truncated.
  error = await errorFor(400, 'Bad Request', 'y'.repeat(900));
  assert.equal(error.message, `${'y'.repeat(500)}…`);

  console.log('REST error message checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
