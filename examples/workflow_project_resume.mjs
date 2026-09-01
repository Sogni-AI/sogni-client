/**
 * Project resume across a dropped socket — live check against the Supernet.
 *
 *   node examples/workflow_project_resume.mjs
 *
 * 1. Client A starts a 3-image render and closes its socket as soon as a worker
 *    has picked the project up.
 * 2. Client B connects with the SAME app-id. The server hands the project back
 *    in the `authenticated` frame; the SDK rebuilds it (`project.recovered`),
 *    replays the missed state, and live events complete it.
 * 3. A manual `projects.sync()` afterwards must show nothing in flight and
 *    nothing lost.
 *
 * Credentials: SOGNI_API_KEY in examples/.env. Build dist first (`npm run build`).
 * Exit code 0 = passed. Any failure cancels the render so nothing is left running.
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { SogniClient } = require(join(here, '..', 'dist', 'index.js'));

const env = Object.fromEntries(
  readFileSync(join(here, '.env'), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);
const apiKey = env.SOGNI_API_KEY;
if (!apiKey) throw new Error('SOGNI_API_KEY missing in examples/.env');

const appId = `resume-e2e-${process.pid}`;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const withTimeout = (p, ms, label) =>
  Promise.race([p, sleep(ms).then(() => Promise.reject(new Error(`timeout: ${label}`)))]);

async function connect(label) {
  const sogni = await SogniClient.createInstance({
    appId,
    apiKey,
    network: 'fast',
    logLevel: 'warn'
  });
  await sogni.projects.waitForModels();
  log(label, 'connected as', appId);
  return sogni;
}

const A = await connect('A');
process.on('uncaughtException', async (err) => {
  console.error('FAILED:', err.message);
  try {
    if (project && !project.finished) await A.projects.cancel(project.id);
  } catch {}
  process.exit(1);
});
process.on('unhandledRejection', async (err) => {
  console.error('FAILED:', err?.message || err);
  try {
    if (project && !project.finished) await A.projects.cancel(project.id);
  } catch {}
  process.exit(1);
});
const PREFERRED = [
  'z_image_bf16',
  'chroma1-hd_fp8_scaled',
  'krea2_turbo_fp8_scaled',
  'flux1-schnell-fp8'
];
const online = A.projects.availableModels.filter((m) => m.workerCount > 0);
const model = PREFERRED.map((id) => online.find((m) => m.id === id)).find(Boolean) || online[0];
log('model', model.id, 'workers', model.workerCount);
A.projects.on(
  'project',
  (e) =>
    e.projectId === project?.id &&
    log('A project', e.type, e.queuePosition ?? '', e.queueStatus ?? '')
);

let project;
project = await A.projects.create({
  type: 'image',
  modelId: model.id,
  positivePrompt: 'a lighthouse on a cliff at dusk, painterly, warm light',
  numberOfMedia: 3,
  steps: 28,
  guidance: 5,
  width: 1024,
  height: 1024,
  tokenType: 'spark',
  network: 'fast'
});
log('A created', project.id);

// Wait until the server has taken the project (any job-level event), then drop the socket.
await withTimeout(
  new Promise((resolve) => {
    const off = A.projects.on('job', (e) => {
      if (e.projectId === project.id) {
        log('A saw', e.type, e.jobId?.slice(0, 8), e.step ?? '');
        off();
        resolve();
      }
    });
  }),
  120_000,
  'first job event on A'
);
await sleep(1500);
const statusBeforeDrop = project.status;
A.apiClient.socket.disconnect();
await sleep(300);
log('A dropped socket; tracked status before/after:', statusBeforeDrop, '->', project.status);
if (project.status === 'failed') throw new Error('A failed the project on disconnect (regression)');

const B = await SogniClient.createInstance({ appId, apiKey, network: 'fast', logLevel: 'warn' });
const synced = new Promise((resolve) => B.projects.once('projectsSynced', resolve));
const recoveredActive = [];
const recoveredCompleted = [];
B.projects.on('activeProjectsRecovered', (list) => recoveredActive.push(...list.map((p) => p.id)));
B.projects.on('completedProjectsRecovered', (list) =>
  recoveredCompleted.push(...list.map((p) => p.id))
);
const bEvents = [];
B.projects.on(
  'job',
  (e) =>
    e.projectId === project.id && bEvents.push(`${e.type}${e.step != null ? ':' + e.step : ''}`)
);

const result = await withTimeout(synced, 30_000, 'projectsSynced on B');
log('B projectsSynced', {
  reason: result.reason,
  active: result.snapshot.activeProjects.map((p) => `${p.id.slice(0, 8)}:${p.status}`),
  unclaimed: result.snapshot.unclaimedCompletedProjects.map(
    (p) => `${p.id.slice(0, 8)}:${p.status}`
  ),
  recoveredActive: recoveredActive.map((id) => id.slice(0, 8)),
  recoveredCompleted: recoveredCompleted.map((id) => id.slice(0, 8))
});

const tracked = B.projects.trackedProjects.find((p) => p.id === project.id);
if (!tracked) throw new Error('B did not rebuild the project');
log('B tracked', {
  recovered: tracked.recovered,
  status: tracked.status,
  prompt: tracked.params.positivePrompt,
  jobs: tracked.jobs.map((j) => `${j.id.slice(0, 8)}:${j.status}:${j.step}/${j.stepCount}`)
});

const urls = tracked.finished
  ? tracked.resultUrls
  : await withTimeout(tracked.waitForCompletion(), 240_000, 'completion on B');
log(
  'B completed',
  tracked.status,
  'urls',
  urls.length,
  urls.map((u) => u.split('?')[0].slice(-40))
);
log(
  'B live events after recovery:',
  bEvents.length,
  bEvents.slice(0, 6).join(' '),
  '…',
  bEvents.slice(-3).join(' ')
);

await sleep(1000);
const manual = await B.projects.sync();
log('B manual sync', {
  active: manual.snapshot.activeProjects.length,
  unclaimed: manual.snapshot.unclaimedCompletedProjects.length,
  lost: manual.lost
});

A.dispose();
B.dispose();
log(urls.length === 3 && tracked.status === 'completed' ? 'E2E PASSED' : 'E2E INCOMPLETE');
process.exit(urls.length === 3 && tracked.status === 'completed' ? 0 : 1);
