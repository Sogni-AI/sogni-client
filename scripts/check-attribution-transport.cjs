const assert = require('node:assert/strict');

const {
  appendConnectionAttributionQuery,
  buildSogniAttributionHeaders,
  normalizeConnectionAttribution,
  resolveWorkloadAttribution,
  workloadAttributionToWireFields
} = require('../dist/lib/attribution.js');
const ApiClient = require('../dist/ApiClient/index.js').default;
const ChatApi = require('../dist/Chat/index.js').default;
const CreativeWorkflowsApi = require('../dist/CreativeWorkflows/index.js').default;
const ProjectsApi = require('../dist/Projects/index.js').default;

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
  constructor({ appSource, connection, workload } = {}) {
    this.appSource = appSource;
    this.attribution = {
      ...(connection ? { connection: normalizeConnectionAttribution(connection) } : {}),
      ...(workload ? { workload } : {})
    };
    this.socket = new StubSocket();
    this.restCalls = [];
    this.rest = {
      baseUrl: 'https://api.example.test',
      post: async (path, body, options) => {
        this.restCalls.push({ path, body, options });
        return {
          id: 'chatcmpl-test',
          object: 'chat.completion',
          created: 1,
          model: body.model || 'test',
          choices: []
        };
      },
      get: async () => ({
        status: 'success',
        data: { uploadUrl: 'https://storage.example.test/presigned' }
      })
    };
    this.auth = {
      isAuthenticated: true,
      authenticateRequest: async (options) => options,
      clear: () => {}
    };
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

  resolveWorkloadAttribution(override, fallbackOperationId) {
    return resolveWorkloadAttribution(
      this.attribution.workload,
      override,
      fallbackOperationId
    );
  }

  attributionHeaders(appSource, override, fallbackOperationId) {
    return buildSogniAttributionHeaders({
      appSource,
      connection: this.attribution.connection,
      workload: this.resolveWorkloadAttribution(override, fallbackOperationId)
    });
  }
}

const IMAGE_MODEL_OPTIONS = {
  type: 'image',
  steps: { min: 1, max: 100, step: 1, default: 20 },
  guidance: { min: 0, max: 20, step: 0.1, default: 7.5 },
  scheduler: { allowed: [], default: null },
  sampler: { allowed: [], default: null }
};

const LOGGER = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {}
};

function headerRecord(headers) {
  if (!headers) return {};
  if (headers instanceof Headers) return Object.fromEntries(headers.entries());
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  return { ...headers };
}

function assertNoSogniTelemetryHeaders(headers) {
  const names = Object.keys(headerRecord(headers)).map((name) => name.toLowerCase());
  assert.equal(
    names.some((name) => name.startsWith('x-sogni-')),
    false,
    `unexpected telemetry header in ${names.join(', ')}`
  );
}

async function checkHelpers() {
  const connection = normalizeConnectionAttribution({
    interactionKind: 'external_agent',
    agentFramework: ' codex ',
    agentFrameworkVersion: ' 1.2.3 ',
    agentSurface: 'native_desktop',
    agentSurfaceVersion: ' 5.0 ',
    executionMode: 'server'
  });
  const url = new URL('wss://socket.example.test/connect');
  appendConnectionAttributionQuery(url, connection);
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    interactionKind: 'external_agent',
    agentFramework: 'codex',
    agentFrameworkVersion: '1.2.3',
    agentSurface: 'native_desktop',
    agentSurfaceVersion: '5.0',
    executionMode: 'server'
  });

  const untouched = new URL('wss://socket.example.test/connect');
  appendConnectionAttributionQuery(untouched, undefined);
  assert.equal(untouched.search, '');

  const resolved = resolveWorkloadAttribution(
    {
      workloadKind: 'agent_mediated',
      agentFramework: 'codex',
      agentFrameworkVersion: '1.2.3',
      agentSurface: 'plugin',
      agentSurfaceVersion: '4.5.6',
      executionMode: 'server'
    },
    {
      agentFramework: 'claude-code',
      agentFrameworkVersion: '2.0.0',
      operationScope: 'child',
      rootOperationId: 'ROOT',
      parentOperationId: 'PARENT'
    },
    'JOB'
  );
  assert.deepEqual(resolved, {
    workloadKind: 'agent_mediated',
    agentFramework: 'claude-code',
    agentFrameworkVersion: '2.0.0',
    agentSurface: 'plugin',
    agentSurfaceVersion: '4.5.6',
    executionMode: 'server',
    operationScope: 'child',
    operationId: 'JOB',
    rootOperationId: 'ROOT',
    parentOperationId: 'PARENT'
  });
  assert.deepEqual(workloadAttributionToWireFields(resolved), resolved);

  const frameworkWithoutVersion = resolveWorkloadAttribution(
    {
      workloadKind: 'agent_mediated',
      agentFramework: 'codex',
      agentFrameworkVersion: '1.2.3'
    },
    { agentFramework: 'openclaw' },
    'NO-STALE-VERSION'
  );
  assert.equal(frameworkWithoutVersion.agentFramework, 'openclaw');
  assert.equal(frameworkWithoutVersion.agentFrameworkVersion, undefined);

  const manualOverride = resolveWorkloadAttribution(
    {
      workloadKind: 'agent_mediated',
      agentFramework: 'sogni-studio',
      agentFrameworkVersion: '5.0.0',
      agentSurface: 'native_desktop'
    },
    { workloadKind: 'direct' },
    'MANUAL-STUDIO-JOB'
  );
  assert.equal(manualOverride.workloadKind, 'direct');
  assert.equal(manualOverride.agentFramework, undefined);
  assert.equal(manualOverride.agentFrameworkVersion, undefined);
  assert.equal(manualOverride.agentSurface, 'native_desktop');

  const topLevel = resolveWorkloadAttribution(
    { workloadKind: 'direct', agentSurface: 'sdk' },
    undefined,
    'TOP'
  );
  assert.equal(topLevel.operationScope, 'top_level');
  assert.equal(topLevel.operationId, 'TOP');
  assert.equal(topLevel.rootOperationId, 'TOP');
  assert.equal(topLevel.parentOperationId, undefined);

  const explicitTopLevel = resolveWorkloadAttribution(
    { workloadKind: 'agent_mediated', agentFramework: 'sogni-chat' },
    { operationScope: 'top_level', operationId: 'USER-TURN' },
    'TRANSPORT-JOB'
  );
  assert.equal(explicitTopLevel.operationId, 'USER-TURN');
  assert.equal(explicitTopLevel.rootOperationId, 'USER-TURN');

  const childWithRoot = resolveWorkloadAttribution(
    { workloadKind: 'agent_mediated', agentFramework: 'sogni-chat' },
    { operationScope: 'child', rootOperationId: 'TURN' },
    'CHILD'
  );
  assert.equal(childWithRoot.parentOperationId, 'TURN');

  const clearedMetadata = resolveWorkloadAttribution(
    { workloadKind: 'agent_mediated', agentFramework: 'codex' },
    { agentFramework: ' ' },
    'CLEARED'
  );
  assert.equal(clearedMetadata.agentFramework, undefined);

  assert.equal(
    resolveWorkloadAttribution(
      undefined,
      {
        workloadKind: 'not-valid',
        agentFramework: '\r\n',
        agentSurface: 'also-invalid',
        operationId: 'x'.repeat(300)
      },
      'SHOULD-NOT-CREATE-ATTRIBUTION'
    ),
    undefined
  );
  assert.deepEqual(workloadAttributionToWireFields(undefined), {});

  const headers = buildSogniAttributionHeaders({
    appSource: ' sogni-chat ',
    connection,
    workload: resolved
  });
  assert.equal(headers['X-App-Source'], 'sogni-chat');
  assert.equal(headers['X-Sogni-Interaction-Kind'], 'external_agent');
  assert.equal(headers['X-Sogni-Agent-Framework'], 'claude-code');
  assert.equal(headers['X-Sogni-Agent-Framework-Version'], '2.0.0');
  assert.equal(headers['X-Sogni-Agent-Surface-Version'], '4.5.6');
  assert.equal(headers['X-Sogni-Operation-Id'], 'JOB');
  assert.equal(headers['X-Sogni-Root-Operation-Id'], 'ROOT');

  const configuredWorkload = {
    workloadKind: 'agent_mediated',
    agentFramework: 'codex',
    agentSurface: 'sdk'
  };
  const apiClient = new ApiClient({
    baseUrl: 'https://api.example.test',
    socketUrl: 'wss://socket.example.test',
    appId: 'attribution-test',
    appSource: 'agent-test',
    attribution: {
      connection: {
        interactionKind: 'external_agent',
        agentFramework: 'codex',
        agentSurface: 'sdk'
      },
      workload: configuredWorkload
    },
    networkType: 'fast',
    logger: LOGGER,
    authType: 'token',
    disableSocket: true
  });
  configuredWorkload.agentFramework = 'mutated-after-construction';
  assert.equal(apiClient.attribution.workload.agentFramework, 'codex');
  assert.ok(Object.isFrozen(apiClient.attribution));
  assert.ok(Object.isFrozen(apiClient.attribution.workload));
  const concurrentA = apiClient.resolveWorkloadAttribution(
    { operationScope: 'child', rootOperationId: 'ROOT-A', parentOperationId: 'PARENT-A' },
    'JOB-A'
  );
  const concurrentB = apiClient.resolveWorkloadAttribution(
    { operationScope: 'child', rootOperationId: 'ROOT-B', parentOperationId: 'PARENT-B' },
    'JOB-B'
  );
  assert.equal(concurrentA.rootOperationId, 'ROOT-A');
  assert.equal(concurrentB.rootOperationId, 'ROOT-B');
  assert.equal(apiClient.attribution.workload.rootOperationId, undefined);

  const realFetch = globalThis.fetch;
  let ownedRestRequest;
  globalThis.fetch = async (url, init) => {
    ownedRestRequest = { url: String(url), init };
    return new Response('{}', {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };
  try {
    await apiClient.rest.post(
      '/v1/owned-operation',
      {},
      {
        headers: apiClient.attributionHeaders(
          'agent-test',
          { executionMode: 'server' },
          'REST-JOB'
        )
      }
    );
  } finally {
    globalThis.fetch = realFetch;
  }
  const ownedHeaders = headerRecord(ownedRestRequest.init.headers);
  assert.equal(ownedHeaders['Content-Type'], 'application/json');
  assert.equal(ownedHeaders['X-App-Source'], 'agent-test');
  assert.equal(ownedHeaders['X-Sogni-Operation-Id'], 'REST-JOB');
  apiClient.dispose();
}

async function checkSocketPayloads() {
  const client = new StubClient({
    appSource: 'sogni-agent-test',
    connection: { interactionKind: 'external_agent', agentSurface: 'sdk' },
    workload: {
      workloadKind: 'agent_mediated',
      agentFramework: 'codex',
      agentSurface: 'sdk',
      executionMode: 'server'
    }
  });
  const chat = new ChatApi({ client, eip712: {} });
  await chat.completions.create({
    model: 'test-model',
    messages: [{ role: 'user', content: 'hello' }],
    stream: true,
    attribution: {
      agentFramework: 'claude-code',
      operationScope: 'child',
      rootOperationId: 'ROOT',
      parentOperationId: 'PARENT'
    }
  });
  const sent = client.socket.sent.at(-1);
  assert.equal(sent.type, 'llmJobRequest');
  assert.equal(sent.data.workloadKind, 'agent_mediated');
  assert.equal(sent.data.agentFramework, 'claude-code');
  assert.equal(sent.data.agentSurface, 'sdk');
  assert.equal(sent.data.operationScope, 'child');
  assert.equal(sent.data.operationId, sent.data.jobID);
  assert.equal(sent.data.rootOperationId, 'ROOT');
  assert.equal(sent.data.parentOperationId, 'PARENT');
  assert.equal('attribution' in sent.data, false);

  const autoLogical = client.resolveWorkloadAttribution(
    { operationScope: 'top_level', operationId: 'AUTO-ROOT' },
    'IGNORED'
  );
  const autoRoot = chat.createAutoToolChildAttribution(autoLogical);
  const autoRoundA = client.resolveWorkloadAttribution(autoRoot, 'AUTO-JOB-A');
  const autoRoundB = client.resolveWorkloadAttribution(autoRoot, 'AUTO-JOB-B');
  assert.equal(autoRoundA.operationScope, 'child');
  assert.equal(autoRoundA.rootOperationId, autoRoundB.rootOperationId);
  assert.equal(autoRoundA.parentOperationId, 'AUTO-ROOT');
  assert.equal(autoRoundA.operationId, 'AUTO-JOB-A');
  assert.equal(autoRoundB.operationId, 'AUTO-JOB-B');

  const nestedAuto = chat.createAutoToolChildAttribution({
    operationId: 'NESTED-LOGICAL',
    operationScope: 'child',
    rootOperationId: 'OUTER-ROOT',
    parentOperationId: 'OUTER-PARENT'
  });
  assert.equal(nestedAuto.rootOperationId, 'OUTER-ROOT');
  assert.equal(nestedAuto.parentOperationId, 'NESTED-LOGICAL');

  const projects = new ProjectsApi({ client, eip712: {} });
  projects.getModelOptions = async () => IMAGE_MODEL_OPTIONS;
  const project = await projects.create({
    type: 'image',
    modelId: 'test-image',
    positivePrompt: 'test',
    numberOfMedia: 1,
    attribution: {
      agentFramework: 'openclaw',
      operationScope: 'child',
      rootOperationId: 'ROOT',
      parentOperationId: 'TOOL'
    }
  });
  const projectRequest = client.socket.sent.at(-1);
  assert.equal(projectRequest.type, 'jobRequest');
  assert.equal(projectRequest.data.agentFramework, 'openclaw');
  assert.equal(projectRequest.data.operationId, project.id);
  assert.equal(projectRequest.data.rootOperationId, 'ROOT');
  assert.equal('attribution' in projectRequest.data, false);
  project._update({
    status: 'failed',
    error: { code: 0, message: 'test cleanup' }
  });

  const legacyClient = new StubClient({ appSource: 'legacy-app' });
  const legacyChat = new ChatApi({ client: legacyClient, eip712: {} });
  await legacyChat.completions.create({
    model: 'test-model',
    messages: [{ role: 'user', content: 'hello' }],
    stream: true
  });
  const legacy = legacyClient.socket.sent.at(-1).data;
  for (const field of [
    'workloadKind',
    'agentFramework',
    'agentFrameworkVersion',
    'agentSurface',
    'agentSurfaceVersion',
    'executionMode',
    'operationScope',
    'operationId',
    'rootOperationId',
    'parentOperationId'
  ]) {
    assert.equal(field in legacy, false, `legacy socket payload unexpectedly included ${field}`);
  }
  assert.equal(legacy.appSource, 'legacy-app');
}

async function checkRestHeaders() {
  const client = new StubClient({
    appSource: 'sogni-chat',
    connection: { interactionKind: 'human_ui', agentSurface: 'native_web' },
    workload: {
      workloadKind: 'agent_mediated',
      agentFramework: 'sogni-chat',
      agentSurface: 'native_web'
    }
  });
  const chat = new ChatApi({ client, eip712: {} });

  await chat.hosted.create({
    model: 'test-model',
    messages: [{ role: 'user', content: 'hello' }],
    attribution: { executionMode: 'browser' }
  });
  let call = client.restCalls.at(-1);
  let headers = headerRecord(call.options.headers);
  assert.equal(call.body.app_source, 'sogni-chat');
  assert.equal('attribution' in call.body, false);
  assert.equal(headers['X-App-Source'], 'sogni-chat');
  assert.equal(headers['X-Sogni-Interaction-Kind'], 'human_ui');
  assert.equal(headers['X-Sogni-Agent-Framework'], 'sogni-chat');
  assert.equal(headers['X-Sogni-Execution-Mode'], 'browser');
  assert.equal(headers['X-Sogni-Operation-Scope'], 'top_level');
  assert.equal(headers['X-Sogni-Operation-Id'], headers['X-Sogni-Root-Operation-Id']);

  await chat.hosted.executeTool({
    tool: 'enhance_prompt',
    arguments: { prompt: 'hello' },
    attribution: {
      agentFramework: 'hermes-agent',
      operationScope: 'child',
      rootOperationId: 'ROOT',
      parentOperationId: 'PARENT'
    }
  });
  call = client.restCalls.at(-1);
  headers = headerRecord(call.options.headers);
  assert.equal('attribution' in call.body, false);
  assert.equal(headers['X-Sogni-Agent-Framework'], 'hermes-agent');
  assert.equal(headers['X-Sogni-Operation-Scope'], 'child');
  assert.equal(headers['X-Sogni-Root-Operation-Id'], 'ROOT');

  const realFetch = globalThis.fetch;
  const fetchCalls = [];
  globalThis.fetch = async (url, init = {}) => {
    fetchCalls.push({ url: String(url), init });
    return new Response(
      JSON.stringify({
        status: 'success',
        data: {
          run: { runId: 'run-test' },
          workflow: { workflowId: 'workflow-test' },
          resumed: true,
          reseed: { cloned_from_run_id: 'workflow-old', steps: [] }
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };

  try {
    await chat.runs.create({
      messages: [{ role: 'user', content: 'hello' }],
      attribution: { executionMode: 'durable' }
    });
    let fetchCall = fetchCalls.at(-1);
    headers = headerRecord(fetchCall.init.headers);
    assert.equal('attribution' in JSON.parse(fetchCall.init.body), false);
    assert.equal(headers['X-Sogni-Execution-Mode'], 'durable');
    assert.equal(headers['X-Sogni-Agent-Framework'], 'sogni-chat');

    const workflows = new CreativeWorkflowsApi({ client, eip712: {} });
    await workflows.start({
      input: { steps: [] },
      attribution: { agentFramework: 'codex', executionMode: 'server' }
    });
    fetchCall = fetchCalls.at(-1);
    headers = headerRecord(fetchCall.init.headers);
    assert.equal('attribution' in JSON.parse(fetchCall.init.body), false);
    assert.equal(headers['X-App-Source'], 'sogni-chat');
    assert.equal(headers['X-Sogni-Agent-Framework'], 'codex');
    assert.equal(headers['X-Sogni-Operation-Scope'], 'top_level');

    await workflows.resume('workflow-test', {
      attribution: {
        operationScope: 'child',
        rootOperationId: 'ROOT',
        parentOperationId: 'PARENT'
      }
    });
    fetchCall = fetchCalls.at(-1);
    headers = headerRecord(fetchCall.init.headers);
    assert.equal(headers['X-Sogni-Operation-Scope'], 'child');
    assert.equal(headers['X-Sogni-Root-Operation-Id'], 'ROOT');

    await workflows.reseed('workflow-test', {
      attribution: { agentFramework: 'openclaw' }
    });
    fetchCall = fetchCalls.at(-1);
    headers = headerRecord(fetchCall.init.headers);
    assert.equal(headers['X-Sogni-Agent-Framework'], 'openclaw');

    // Presigned third-party uploads must receive only storage-required headers,
    // even when the owning Sogni client has attribution defaults.
    const projects = new ProjectsApi({ client, eip712: {} });
    await projects.uploadGuideImage('PROJECT', new Blob(['image'], { type: 'image/png' }));
    fetchCall = fetchCalls.at(-1);
    assert.equal(fetchCall.url, 'https://storage.example.test/presigned');
    assert.equal(fetchCall.init.method, 'PUT');
    assertNoSogniTelemetryHeaders(fetchCall.init.headers);
    assert.equal(
      Object.keys(headerRecord(fetchCall.init.headers)).some(
        (name) => name.toLowerCase() === 'x-app-source'
      ),
      false
    );
  } finally {
    globalThis.fetch = realFetch;
  }

  const legacyClient = new StubClient({ appSource: 'legacy-app' });
  const legacyChat = new ChatApi({ client: legacyClient, eip712: {} });
  await legacyChat.hosted.create({
    model: 'test-model',
    messages: [{ role: 'user', content: 'hello' }]
  });
  const legacyHeaders = headerRecord(legacyClient.restCalls.at(-1).options.headers);
  assert.equal(legacyHeaders['X-App-Source'], 'legacy-app');
  assertNoSogniTelemetryHeaders(legacyHeaders);
}

async function run() {
  await checkHelpers();
  await checkSocketPayloads();
  await checkRestHeaders();
  console.log('check-attribution-transport: OK');
}

run().catch((error) => {
  console.error('check-attribution-transport: FAIL');
  console.error(error);
  process.exitCode = 1;
});
