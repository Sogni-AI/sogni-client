#!/usr/bin/env node
/**
 * Krea 2 LoRA Stacking Workflow
 *
 * Demonstrates attaching several Krea 2 LoRAs to one render, which is where
 * this family differs from most LoRAs you may have used elsewhere:
 *
 * - They are mostly **bipolar sliders**. A negative strength applies the
 *   inverse effect rather than turning it off, and 0 does nothing. Warm Light
 *   warms an image at +2 and cools it at -2.
 * - They **stack**, up to 8 on a single render.
 * - **Order matters.** LoRAs are applied in the order given, and the same set
 *   in a different order gives a measurably different image, because these
 *   models run fp8-quantized and the patches do not commute. Pass --reverse to
 *   render the same stack both ways and compare.
 *
 * Each LoRA has its own valid range and an author-recommended band. Values
 * outside the valid range are clamped server-side. Pushing past the
 * recommended band usually costs detail rather than adding effect.
 *
 * The full catalog — ids, ranges, credits and example renders — is browsable in
 * the Sogni app under the LoRAs panel. A few common ids:
 *
 *   krea2-detail-enhancer   -2 .. +5    fine detail and clarity
 *   krea2-amateur           -2 .. +2    negative = polished, positive = snapshot
 *   krea2-candid            +3 .. +9    breaks the posed, staged "AI look"
 *   krea2-realism           -1 .. +1    negative = illustrated, positive = photo
 *   krea2-warm-light        -3 .. +3    negative = cool, positive = golden
 *   krea2-skin-detail     -0.5 .. +3    skin texture only
 *   krea2-zoom              -5 .. +5    framing, if the prompt leaves it open
 *
 * Prerequisites:
 * - Set SOGNI_API_KEY or SOGNI_USERNAME/SOGNI_PASSWORD in .env (or you'll be prompted)
 * - Requires the 'fast' network
 *
 * Usage:
 *   node workflow_krea2_lora_stack.mjs
 *   node workflow_krea2_lora_stack.mjs "a woman crossing a city street at dusk"
 *   node workflow_krea2_lora_stack.mjs --loras krea2-detail-enhancer:3,krea2-amateur:-2
 *   node workflow_krea2_lora_stack.mjs --reverse
 *
 * Options:
 *   --loras     Comma-separated id:strength pairs, applied in this order
 *               (default: krea2-detail-enhancer:3,krea2-amateur:-2,krea2-warm-light:1.5)
 *   --reverse   Also render the stack in reverse order, to show order matters
 *   --model     Model id (default: krea2_turbo_fp8_scaled)
 *   --seed      Seed; the same seed is used for every render so they compare
 *   --steps     Inference steps (default: 8)
 *   --width     Output width (default: 832)
 *   --height    Output height (default: 1216)
 *   --output    Output directory (default: ./output)
 *   --help      Show this message
 */
import { SogniClient } from '../dist/index.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadCredentials } from './credentials.mjs';

const DEFAULT_STACK = 'krea2-detail-enhancer:3,krea2-amateur:-2,krea2-warm-light:1.5';
const DEFAULT_PROMPT =
  'A woman in her mid-20s with a short curly afro, wearing a bright yellow midi dress, ' +
  'crossing a city street at dusk, shot on 35mm film';
/** Keep in sync with the server limit; requests over it are rejected. */
const MAX_LORAS = 8;

function parseArgs(argv) {
  const options = {
    prompt: null,
    loras: DEFAULT_STACK,
    reverse: false,
    model: 'krea2_turbo_fp8_scaled',
    seed: Math.floor(Math.random() * 4294967295),
    steps: 8,
    width: 832,
    height: 1216,
    output: './output'
  };
  const positional = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0]);
      process.exit(0);
    } else if (arg === '--reverse') {
      options.reverse = true;
    } else if (arg.startsWith('--') && argv[i + 1] !== undefined) {
      const key = arg.slice(2);
      const value = argv[++i];
      if (key in options) {
        options[key] = ['seed', 'steps', 'width', 'height'].includes(key) ? Number(value) : value;
      }
    } else if (!arg.startsWith('--')) {
      positional.push(arg);
    }
  }

  if (positional.length) options.prompt = positional.join(' ');
  return options;
}

/** "id:strength,id:strength" -> [{ loraId, strength }], preserving order. */
function parseStack(spec) {
  const pairs = spec
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const separator = entry.lastIndexOf(':');
      if (separator === -1) return { loraId: entry, strength: 1 };
      const loraId = entry.slice(0, separator).trim();
      const strength = Number(entry.slice(separator + 1));
      if (!loraId) throw new Error(`Missing LoRA id in "${entry}"`);
      if (!Number.isFinite(strength)) throw new Error(`Bad strength in "${entry}"`);
      return { loraId, strength };
    });

  if (pairs.length > MAX_LORAS) {
    throw new Error(`Too many LoRAs: ${pairs.length} given, the limit is ${MAX_LORAS}`);
  }
  const ids = pairs.map((pair) => pair.loraId);
  const duplicate = ids.find((id, i) => ids.indexOf(id) !== i);
  if (duplicate) throw new Error(`LoRA "${duplicate}" listed twice`);
  return pairs;
}

const describeStack = (stack) =>
  stack.map(({ loraId, strength }) => `${loraId}@${strength > 0 ? '+' : ''}${strength}`).join(' → ');

async function render(sogni, options, stack, label) {
  console.log(`\n🎚️  ${label}: ${describeStack(stack)}`);

  const project = await sogni.projects.create({
    type: 'image',
    modelId: options.model,
    positivePrompt: options.prompt || DEFAULT_PROMPT,
    numberOfMedia: 1,
    seed: options.seed,
    steps: options.steps,
    sizePreset: 'custom',
    width: options.width,
    height: options.height,
    // Positional: loraStrengths[i] is the strength for loras[i], and the array
    // order is the order the LoRAs are chained in.
    loras: stack.map((entry) => entry.loraId),
    loraStrengths: stack.map((entry) => entry.strength)
  });

  const urls = await project.waitForCompletion();
  const file = path.join(options.output, `krea2-stack-${label.toLowerCase().replace(/\W+/g, '-')}.png`);
  fs.writeFileSync(file, Buffer.from(await (await fetch(urls[0])).arrayBuffer()));
  console.log(`💾 Saved: ${file}`);
  return file;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const stack = parseStack(options.loras);
  fs.mkdirSync(options.output, { recursive: true });

  const credentials = await loadCredentials();
  const clientConfig = { appId: `krea2-lora-stack-${Date.now()}`, network: 'fast' };
  if (credentials.apiKey) clientConfig.apiKey = credentials.apiKey;
  const sogni = await SogniClient.createInstance(clientConfig);

  try {
    if (!credentials.apiKey) {
      await sogni.account.login(credentials.username, credentials.password);
    }
    console.log(`✓ Authenticated · model ${options.model} · seed ${options.seed}`);

    await render(sogni, options, stack, 'stack');

    if (options.reverse) {
      // Same LoRAs, same strengths, same seed — only the chain order differs.
      // The two images will not match.
      await render(sogni, options, [...stack].reverse(), 'reversed');
      console.log('\nBoth renders used the same seed and strengths. The only difference is');
      console.log('the order the LoRAs were applied in, and that is enough to change the image.');
    }
  } finally {
    // API-key sessions have no logout endpoint, so that call may reject.
    await sogni.account.logout().catch(() => {});
    // Releases the WebSocket. Without this the process never exits.
    sogni.dispose();
  }
}

main().catch((error) => {
  console.error(`\n❌ ${error.message}`);
  process.exit(1);
});
