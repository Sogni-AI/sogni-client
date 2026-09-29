/** Generate a JSON list of stills using an API key from examples/.env or the environment. */
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SogniClient } from '../dist/index.js';

if (process.argv.includes('--help')) {
  console.log('MODEL_ID=<model> SHOTS=<shots.json> node examples/.kb-gen-stills.mjs <output-dir>');
  console.log('Each shot needs name, prompt, width, height, and seed; negative is optional.');
  console.log('LIST_ONLY=1 lists available models without generating images.');
  process.exit(0);
}

dotenv.config({ path: fileURLToPath(new URL('.env', import.meta.url)) });
const listOnly = process.env.LIST_ONLY === '1';
const outDir = process.argv[2] ? path.resolve(process.argv[2]) : undefined;
const modelId = process.env.MODEL_ID;
if (!listOnly && (!outDir || !modelId || !process.env.SHOTS)) {
  throw new Error('Provide an output directory, MODEL_ID, and a SHOTS JSON file.');
}
const shots = listOnly ? [] : JSON.parse(fs.readFileSync(process.env.SHOTS || '', 'utf8'));
if (!process.env.SOGNI_API_KEY)
  throw new Error('Set SOGNI_API_KEY in examples/.env or the environment.');
if (!listOnly) {
  if (!outDir || !modelId || !Array.isArray(shots) || shots.length === 0) {
    throw new Error('Provide an output directory, MODEL_ID, and a nonempty SHOTS JSON array.');
  }
  const names = new Set();
  for (const shot of shots) {
    if (
      !shot ||
      typeof shot.name !== 'string' ||
      !shot.name.endsWith('.png') ||
      path.basename(shot.name) !== shot.name ||
      shot.name.includes('\\') ||
      typeof shot.prompt !== 'string' ||
      !shot.prompt.trim() ||
      !Number.isInteger(shot.width) ||
      shot.width <= 0 ||
      !Number.isInteger(shot.height) ||
      shot.height <= 0 ||
      !Number.isInteger(shot.seed) ||
      (shot.negative !== undefined && typeof shot.negative !== 'string')
    ) {
      throw new Error('Each shot needs a plain .png filename, prompt, integer size and seed.');
    }
    if (names.has(shot.name) || fs.existsSync(path.join(outDir, shot.name))) {
      throw new Error(`Output already exists or is repeated: ${shot.name}`);
    }
    names.add(shot.name);
  }
  fs.mkdirSync(outDir, { recursive: true });
}

const client = await SogniClient.createInstance({
  appId: `still-batch-${Date.now()}`,
  network: 'fast',
  apiKey: process.env.SOGNI_API_KEY
});
try {
  const models = await client.projects.waitForModels(30_000);
  if (listOnly) {
    console.log(
      models
        .map((model) => `${model.id}  x${model.workerCount}`)
        .sort()
        .join('\n')
    );
  } else {
    for (const shot of shots) {
      console.log('→', shot.name);
      const project = await client.projects.create({
        type: 'image',
        modelId,
        positivePrompt: shot.prompt,
        negativePrompt: shot.negative ?? '',
        stylePrompt: '',
        steps: 30,
        guidance: 3.5,
        numberOfMedia: 1,
        outputFormat: 'png',
        width: shot.width,
        height: shot.height,
        seed: shot.seed,
        tokenType: process.env.SOGNI_TOKEN_TYPE || 'spark',
        network: 'fast'
      });
      const [url] = await project.waitForCompletion();
      if (!url) throw new Error(`No image returned for ${shot.name}`);
      const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (!response.ok) throw new Error(`Image download failed with HTTP ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      fs.writeFileSync(path.join(outDir, shot.name), buffer, { flag: 'wx' });
      console.log('  saved', shot.name, buffer.length, 'bytes');
    }
  }
} finally {
  client.dispose();
}
