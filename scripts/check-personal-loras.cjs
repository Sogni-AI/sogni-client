'use strict';
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const ProjectsApi = require('../dist/Projects/index.js').default;
const PersonalLoras = require('../dist/Projects/PersonalLoras.js').default;

async function main() {
  let owner = 'one';
  let calls = [];
  let pending;
  const auth = new EventEmitter();
  const row = () => ({ loraId: `personal-${owner}`, modelIds: ['model-a'], ui: { min: 0, max: 0.8, default: 0.8 } });
  const rest = {
    auth,
    async get(path) {
      calls.push(['GET', path]);
      if (pending) return pending;
      if (path === '/v1/loras/comfy') return { data: { loras: [], models: ['public-model'] } };
      if (path.endsWith('/catalog')) return { data: { loras: [row()] } };
      if (path === '/v1/loras/personal') return { data: { loras: [{ id: `personal-${owner}`, status: 'queued' }], models: ['model-a'], limits: { fileBytes: null } } };
      return { data: { id: decodeURIComponent(path.split('/').pop()), status: 'ready' } };
    },
    async post(path, body) { calls.push(['POST', path, body]); return { data: { id: 'personal-new', status: 'queued' } }; },
    async delete(path) { calls.push(['DELETE', path]); }
  };
  const library = new PersonalLoras(rest);
  assert.equal((await library.list()).limits.fileBytes, null);
  const input = { name: 'My style', modelId: 'model-a', url: 'https://huggingface.co/example/style/blob/main/style.safetensors', rightsConfirmed: true };
  assert.equal((await library.import(input)).status, 'queued');
  assert.deepEqual(calls.at(-1), ['POST', '/v1/loras/personal', input]);
  assert.equal((await library.get('personal-a/b')).id, 'personal-a/b');
  await library.remove('personal-a/b');
  assert.equal(calls.at(-1)[1], '/v1/loras/personal/personal-a%2Fb');
  assert.equal((await library.catalog({ modelId: 'foreign' })).loras.length, 0);

  const client = Object.assign(new EventEmitter(), { rest, socket: new EventEmitter(), logger: { info() {}, warn() {}, error() {}, debug() {} } });
  const projects = new ProjectsApi({ client, eip712: {} });
  const first = await projects.availableLoras({ includePersonal: true, forceRefresh: true });
  assert.deepEqual(first.models, ['model-a', 'public-model']);
  assert.equal(first.loras[0].loraId, 'personal-one');
  owner = 'two'; auth.emit('updated');
  assert.equal((await projects.availableLoras({ includePersonal: true })).loras[0].loraId, 'personal-two');
  assert.equal((await projects.availableLoras()).loras.length, 0, 'private rows must never enter the public cache');
  assert.equal((await projects.getLora('personal-two')).ui.max, 0.8);
  assert.equal((await projects.availableLoras({ includePersonal: true, modelId: 'foreign' })).loras.length, 0);

  let resolve;
  pending = new Promise(done => { resolve = done; });
  const stale = library.catalog();
  auth.emit('updated');
  resolve({ data: { loras: [row()] } });
  await assert.rejects(stale, /account changed/);
  pending = Promise.reject(new Error('Subscription required'));
  await assert.rejects(projects.availableLoras({ includePersonal: true }), /Subscription required/);
  console.log('Personal LoRA SDK checks passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
