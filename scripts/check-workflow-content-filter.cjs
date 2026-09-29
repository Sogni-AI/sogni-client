const assert = require('node:assert/strict');
const CreativeWorkflowsApi = require('../dist/CreativeWorkflows/index.js').default;

const api = new CreativeWorkflowsApi({
  client: {
    auth: { authenticateRequest: async (init) => init },
    rest: { baseUrl: 'https://api.example.test' }
  },
  eip712: {}
});
const realFetch = globalThis.fetch;
let lastRequest;
globalThis.fetch = async (url, init) => {
  lastRequest = { url: String(url), method: init.method, body: JSON.parse(init.body) };
  return new Response(JSON.stringify({
    status: 'success',
    data: { workflow: { workflowId: 'wf_test', safeContentFilter: false } }
  }), { status: 201, headers: { 'Content-Type': 'application/json' } });
};

async function run() {
  const plans = [
    { workflowId: 'wf_template', inputs: { brief: 'A ceramic vase' } },
    { input: { steps: [{ toolName: 'generate_image', arguments: { prompt: 'A ceramic vase' } }] } }
  ];
  for (const plan of plans) {
    for (const preference of [true, false, undefined]) {
      const result = await api.start({ ...plan, safeContentFilter: preference });
      assert.equal(lastRequest.method, 'POST');
      assert.equal(lastRequest.url, 'https://api.example.test/v1/creative-agent/workflows');
      assert.equal(lastRequest.body.safe_content_filter, preference);
      assert.equal(Object.hasOwn(lastRequest.body, 'safe_content_filter'), preference !== undefined);
      assert.equal(Object.hasOwn(lastRequest.body, 'safeContentFilter'), false);
      assert.equal(result.safeContentFilter, false, 'response preserves the stored preference');
    }
  }
  await api.start({ workflowId: 'wf_template', safe_content_filter: false });
  assert.equal(lastRequest.body.safe_content_filter, false, 'snake-case alias preserves false');
  for (const preference of [true, false]) {
    await api.start({
      workflowId: 'wf_template',
      safeContentFilter: preference,
      safe_content_filter: !preference
    });
    assert.equal(lastRequest.body.safe_content_filter, preference, 'camel-case option takes precedence');
  }
  await api.start({ workflowId: 'wf_template', inputs: { safe_content_filter: false } });
  assert.equal(Object.hasOwn(lastRequest.body, 'safe_content_filter'), false, 'template input stays nested');

  for (const action of ['resume', 'reseed']) {
    await api[action]('wf_test', { safeContentFilter: true, safe_content_filter: true });
    assert.equal(Object.hasOwn(lastRequest.body, 'safe_content_filter'), false, `${action} cannot replace the saved preference`);
  }
  console.log('Workflow content filter transport checks passed.');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => { globalThis.fetch = realFetch; });
