/**
 * Regression: the workflow templates SDK group must unwrap the api's
 * `{ status: "success", data: { ... } }` envelope before reading
 * `template` / `templates` / `next`. Prior to alpha.8 it read top-level
 * fields, causing every `create / get / update / fork` to throw "missing
 * template field" and every `list` to silently return `[]`.
 */
const assert = require('node:assert/strict');

const {
  __envelopeInternals
} = require('../dist/CreativeWorkflows/Templates/index.js');
const CreativeWorkflowTemplatesApi
  = require('../dist/CreativeWorkflows/Templates/index.js').default;

const { parseSuccessEnvelope, parseErrorEnvelope } = __envelopeInternals;

// ---------------------------------------------------------------------------
// Unit: envelope parsers
// ---------------------------------------------------------------------------

const sampleTemplate = {
  id: 'wf_user_42',
  version: '0.0.1',
  name: 'My Plastic Dream'
};

// 2xx success envelope: should expose the inner `data` object.
assert.deepEqual(
  parseSuccessEnvelope(JSON.stringify({
    status: 'success',
    data: { template: sampleTemplate }
  })),
  { template: sampleTemplate },
  'parseSuccessEnvelope must strip the `{status, data}` wrapper'
);

// Legacy / unwrapped payload: pass through unchanged.
assert.deepEqual(
  parseSuccessEnvelope(JSON.stringify({ template: sampleTemplate })),
  { template: sampleTemplate },
  'parseSuccessEnvelope falls through when no envelope is present'
);

// List with pagination cursor: api sends `data.next`, sdk must surface it.
const listEnvelope = parseSuccessEnvelope(JSON.stringify({
  status: 'success',
  data: { templates: [sampleTemplate], next: 20 }
}));
assert.equal(listEnvelope.next, 20, 'list pagination cursor preserved');
assert.equal(listEnvelope.templates.length, 1, 'list templates preserved');

// Error parser: api error responses live at the top level.
assert.deepEqual(
  parseErrorEnvelope(JSON.stringify({
    status: 'error',
    errorCode: 101,
    message: 'Authorization header or auth cookie required'
  })),
  {
    status: 'error',
    errorCode: 101,
    message: 'Authorization header or auth cookie required'
  },
  'parseErrorEnvelope keeps top-level error shape'
);

// Defensive: malformed JSON should not throw — fall back to plain message.
assert.deepEqual(parseSuccessEnvelope('<html>500</html>'), {});
assert.deepEqual(parseErrorEnvelope('not-json'), { message: 'not-json' });

// ---------------------------------------------------------------------------
// Integration: instantiate the class with a stub ApiClient and verify each
// public method unwraps correctly. Patches `globalThis.fetch` to return
// crafted Response objects.
// ---------------------------------------------------------------------------

class StubAuth {
  constructor() {
    this.isAuthenticated = true;
  }
  async authenticateRequest(init) {
    return init ?? {};
  }
  clear() {
    this.isAuthenticated = false;
  }
}

const stubClient = {
  auth: new StubAuth(),
  rest: { baseUrl: 'https://api.example.test' }
};

const stubConfig = { client: stubClient, eip712: {} };
const api = new CreativeWorkflowTemplatesApi(stubConfig);

let lastRequest = null;
const realFetch = globalThis.fetch;

function mockFetch(responseFactory) {
  globalThis.fetch = async (url, init) => {
    lastRequest = { url: String(url), init };
    return responseFactory(url, init);
  };
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

async function run() {
  // create() unwraps `data.template`
  mockFetch(() => jsonResponse(201, {
    status: 'success',
    data: { template: { ...sampleTemplate, id: 'wf_created' } }
  }));
  const created = await api.create({ name: 'My Plastic Dream' });
  assert.equal(created.id, 'wf_created', 'create() returns the created template');
  assert.equal(lastRequest.init.method, 'POST');
  assert.ok(
    lastRequest.url.endsWith('/v1/creative-agent/workflows/templates'),
    'create() hits the templates endpoint'
  );

  // get() unwraps `data.template`
  mockFetch(() => jsonResponse(200, {
    status: 'success',
    data: { template: { ...sampleTemplate, id: 'wf_gotten' } }
  }));
  const got = await api.get('wf_gotten');
  assert.equal(got.id, 'wf_gotten', 'get() returns the resolved template');

  // update() unwraps `data.template`
  mockFetch(() => jsonResponse(200, {
    status: 'success',
    data: { template: { ...sampleTemplate, id: 'wf_updated', name: 'renamed' } }
  }));
  const updated = await api.update('wf_42', { name: 'renamed' });
  assert.equal(updated.name, 'renamed', 'update() returns the patched template');
  assert.equal(lastRequest.init.method, 'PATCH');

  // fork() unwraps `data.template`
  mockFetch(() => jsonResponse(201, {
    status: 'success',
    data: { template: { ...sampleTemplate, id: 'wf_forked' } }
  }));
  const forked = await api.fork('wf_42', { name: 'fork copy' });
  assert.equal(forked.id, 'wf_forked', 'fork() returns the forked template');
  assert.ok(lastRequest.url.endsWith('/fork'), 'fork() hits the /fork suffix');

  // list() unwraps `data.templates` + `data.next`
  mockFetch(() => jsonResponse(200, {
    status: 'success',
    data: {
      templates: [
        sampleTemplate,
        { ...sampleTemplate, id: 'wf_b', name: 'B' }
      ],
      next: 20
    }
  }));
  const listed = await api.list({ visibility: 'all', limit: 200 });
  assert.equal(listed.templates.length, 2, 'list() returns both templates');
  assert.equal(listed.nextCursor, 20, 'list() surfaces data.next as nextCursor');

  // delete() must not throw on the `{ status, data: { deleted, id } }` shape
  mockFetch(() => jsonResponse(200, {
    status: 'success',
    data: { deleted: true, id: 'wf_42' }
  }));
  await api.delete('wf_42');

  // Error path: api error envelope is top-level, message+errorCode propagate.
  mockFetch(() => jsonResponse(401, {
    status: 'error',
    errorCode: 101,
    message: 'Authorization header or auth cookie required'
  }));
  await assert.rejects(
    async () => api.create({ name: 'unauth' }),
    (err) => {
      assert.equal(err.status, 401);
      assert.equal(err.payload.errorCode, 101);
      assert.equal(
        err.payload.message,
        'Authorization header or auth cookie required'
      );
      return true;
    }
  );

  // Server-side success-shape regression: payload missing `template` must
  // surface the canonical SDK error.
  mockFetch(() => jsonResponse(201, { status: 'success', data: {} }));
  await assert.rejects(
    async () => api.create({ name: 'malformed' }),
    /Workflow template create response missing template field/
  );

  console.log('check-workflow-template-envelope: OK');
}

run()
  .catch((err) => {
    console.error('check-workflow-template-envelope: FAIL');
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    globalThis.fetch = realFetch;
  });
