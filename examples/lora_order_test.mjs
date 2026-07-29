#!/usr/bin/env node
/**
 * Does LoRA chain order change the image?
 *
 * The worker chains LoraLoaderModelOnly nodes in array order, so A,B builds
 * UNET -> A -> B and B,A builds UNET -> B -> A. LoRA deltas are additive, which
 * is commutative in exact arithmetic, but Krea 2 runs fp8-quantized and
 * per-patch rounding can make it non-commutative in practice. Only a render
 * settles it.
 *
 * Renders every permutation of the given LoRAs at a fixed seed on one worker.
 */
import { SogniClient } from '../dist/index.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

function arg(name, fallback) {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  return hit.includes('=') ? hit.slice(hit.indexOf('=') + 1) : process.argv[process.argv.indexOf(hit) + 1];
}

// "detail-enhancer:3,amateur:-2" -> [['krea2-detail-enhancer',3], ...]
const PAIRS = arg('loras', 'krea2-detail-enhancer:3,krea2-amateur:-2')
  .split(',')
  .map((s) => {
    const [id, v] = s.split(':');
    return [id.startsWith('krea2-') ? id : `krea2-${id}`, Number(v)];
  });
const SEED = Number(arg('seed', '1977132337'));
const WORKER = arg('worker', 'Allen,beeple,not.beeple');
const OUT = arg('out', path.join(process.env.HOME, 'Downloads/lora-order-test'));
const PROMPT = fs.readFileSync(arg('prompt-file'), 'utf8').trim();

function permutations(items) {
  if (items.length <= 1) return [items];
  return items.flatMap((item, i) =>
    permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest])
  );
}

const apiKey = process.env.SOGNI_API_KEY;
fs.mkdirSync(OUT, { recursive: true });
const sogni = await SogniClient.createInstance({
  appId: `lora-order-${Date.now()}`,
  network: 'fast',
  apiKey
});

const perms = permutations(PAIRS);
console.log(`${perms.length} permutation(s) of ${PAIRS.length} LoRAs, seed ${SEED}\n`);

for (const perm of perms) {
  const label = perm.map(([id, v]) => `${id.replace('krea2-', '')}@${v}`).join('__');
  process.stdout.write(`${label.padEnd(46)} `);
  const project = await sogni.projects.create({
    type: 'image',
    modelId: 'krea2_turbo_fp8_scaled',
    positivePrompt: `${PROMPT} --workers=${WORKER}`,
    numberOfMedia: 1,
    seed: SEED,
    tokenType: 'spark',
    sizePreset: 'custom',
    width: 832,
    height: 1216,
    outputFormat: 'png',
    loras: perm.map(([id]) => id),
    loraStrengths: perm.map(([, v]) => v)
  });
  const urls = await project.waitForCompletion();
  const worker = project.jobs?.[0]?.workerName ?? '?';
  const file = path.join(OUT, `${label}.png`);
  fs.writeFileSync(file, Buffer.from(await (await fetch(urls[0])).arrayBuffer()));
  console.log(`worker=${worker}`);
}
console.log(`\n${perms.length} renders -> ${OUT}`);
process.exit(0);
