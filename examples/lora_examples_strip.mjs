#!/usr/bin/env node
/**
 * LoRA comparison strip.
 *
 * Renders one prompt at a fixed seed across a sweep of strengths for a single
 * LoRA, so the frames differ by the slider and nothing else. Output feeds the
 * LoRA explorer's preview tiles in sogni-web.
 *
 * Every frame is pinned to one worker via the --workers tag so the whole strip
 * comes off the same GPU. That tag only takes effect on a premium-spark
 * account; without one the job silently rotates to whatever worker is free.
 *
 * Usage:
 *   SOGNI_API_KEY=... node lora_examples_strip.mjs \
 *     --lora krea2-amateur --values=-2,-1,off,1,2 --worker mark.and.worker
 */
import { SogniClient } from '../dist/index.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

function arg(name, fallback) {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  if (hit.includes('=')) return hit.slice(hit.indexOf('=') + 1);
  return process.argv[process.argv.indexOf(hit) + 1] ?? fallback;
}

const LORA = arg('lora', 'krea2-amateur');
// Always ordered by strength with "off" sitting at its true position (0), so a
// positive-only sweep puts the baseline on the left rather than mid-strip.
const VALUES = arg('values', '-2,-1,off,1,2')
  .split(',')
  .map((v) => v.trim())
  .filter(Boolean)
  .sort((a, b) => {
    const num = (v) => (v.toLowerCase() === 'off' ? 0 : Number(v));
    return num(a) - num(b);
  });
const WORKER = arg('worker', 'mark.and.worker');
const SEED = Number(arg('seed', '1977132337'));
const MODEL = arg('model', 'krea2_turbo_fp8_scaled');
const OUT = arg('out', path.join(process.env.HOME, 'Downloads/krea2-lora-examples'));
const PROMPT_FILE = arg('prompt-file', null);
const NEGATIVE_FILE = arg('negative-file', null);
const DISABLE_FILTER = process.argv.includes('--disable-safe-content-filter');

const positivePrompt = PROMPT_FILE ? fs.readFileSync(PROMPT_FILE, 'utf8').trim() : arg('prompt', '');
const negativePrompt = NEGATIVE_FILE ? fs.readFileSync(NEGATIVE_FILE, 'utf8').trim() : '';
if (!positivePrompt) {
  console.error('Need --prompt or --prompt-file');
  process.exit(1);
}

const apiKey = process.env.SOGNI_API_KEY;
if (!apiKey) {
  console.error('Need SOGNI_API_KEY (premium spark, or --workers will not pin)');
  process.exit(1);
}

fs.mkdirSync(OUT, { recursive: true });

// API-key auth is configured on the instance; there is no separate login call.
const sogni = await SogniClient.createInstance({
  appId: `lora-examples-${Date.now()}`,
  network: 'fast',
  apiKey
});
console.log(`Authenticated. Pinning every frame to worker "${WORKER}".\n`);

const results = [];
for (const raw of VALUES) {
  const off = raw.toLowerCase() === 'off';
  const strength = off ? 0 : Number(raw);
  const tag = off ? 'off' : strength > 0 ? `pos${strength}` : `neg${Math.abs(strength)}`;
  const label = `${LORA}_${tag}`;

  // The worker tag is stripped from the prompt by sogni-socket before it
  // reaches the model, so it does not pollute the conditioning.
  const params = {
    type: 'image',
    modelId: MODEL,
    positivePrompt: `${positivePrompt} --workers=${WORKER}`,
    negativePrompt,
    numberOfMedia: 1,
    seed: SEED,
    tokenType: 'spark',
    sizePreset: 'custom',
    width: Number(arg('width', '832')),
    height: Number(arg('height', '1216')),
    outputFormat: 'png',
    disableNSFWFilter: DISABLE_FILTER
  };
  // "off" is the untouched model, not the LoRA at 0.
  if (!off) {
    params.loras = [LORA];
    params.loraStrengths = [strength];
  }

  process.stdout.write(`${label.padEnd(28)} `);
  const started = Date.now();
  const project = await sogni.projects.create(params);
  const urls = await project.waitForCompletion();
  const secs = ((Date.now() - started) / 1000).toFixed(1);

  const workerName = project.jobs?.[0]?.workerName ?? 'unknown';
  const file = path.join(OUT, `${label}.png`);
  const res = await fetch(urls[0]);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  console.log(`${secs}s  worker=${workerName}  -> ${path.basename(file)}`);
  results.push({ label, strength: off ? 'off' : strength, worker: workerName, file });
}

fs.writeFileSync(path.join(OUT, 'strip.json'), JSON.stringify({ lora: LORA, seed: SEED, model: MODEL, results }, null, 2));
const workers = [...new Set(results.map((r) => r.worker))];
console.log(`\n${results.length} frames -> ${OUT}`);
console.log(workers.length === 1 ? `All frames from one worker: ${workers[0]}` : `WARNING: mixed workers: ${workers.join(', ')}`);
process.exit(0);
