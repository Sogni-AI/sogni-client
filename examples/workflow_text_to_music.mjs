#!/usr/bin/env node
/**
 * Text-to-Music Workflow
 *
 * This script generates music from text prompts using the ACE-Step 1.5 SFT model
 * via the SDK's native audio project support.
 *
 * Prerequisites:
 * - Set SOGNI_USERNAME and SOGNI_PASSWORD in .env file (or will prompt)
 * - Audio workers must be available on the network
 *
 * Usage:
 *   node workflow_text_to_music.mjs                                    # Interactive mode
 *   node workflow_text_to_music.mjs "upbeat electronic dance music"    # With prompt
 *   node workflow_text_to_music.mjs "jazz ballad" --duration 60        # With options
 *
 * Options:
 *   --duration        Duration in seconds (10-600, default: 60)
 *   --bpm             Beats per minute (30-300, default: 123)
 *   --keyscale        Musical key (e.g., "C major", "A minor", default: F minor)
 *   --timesig         Time signature (2, 3, 4, 6, default: 4)
 *   --language        Lyrics language (default: en)
 *   --lyrics          Song lyrics (default: included)
 *   --steps           Inference steps (10-200, default: 50)
 *   --guidance        Diffusion CFG guidance (1-15, default: 5)
 *   --composer-mode   Enable AI composer (true/false, default: true)
 *   --prompt-strength How closely composer follows prompt (0-10, default: 2.0)
 *   --creativity      Composition variation (0-2, default: 0.85)
 *   --sampler         Sampler algorithm (default: er_sde)
 *   --scheduler       Scheduler algorithm (default: linear_quadratic)
 *   --seed            Random seed (default: -1 for random)
 *   --format          Output format: mp3, wav, flac (default: mp3)
 *   --batch           Number of tracks to generate (default: 1)
 *   --output          Output directory (default: ./output)
 *   --no-interactive  Skip interactive prompts
 *   --help            Show this help message
 */

import { SogniClient } from '../dist/index.js';
import * as fs from 'node:fs';
import { pipeline } from 'node:stream';
import { promisify } from 'node:util';
import { exec } from 'node:child_process';
import {
  loadCredentials,
  loadTokenTypePreference,
  saveTokenTypePreference
} from './credentials.mjs';
import {
  askQuestion,
  askMultilinePrompt,
  log,
  formatDuration,
  displayConfig,
  generateRandomSeed,
  toKebabCase,
  getUniqueFilename
} from './workflow-helpers.mjs';

const streamPipeline = promisify(pipeline);

const AUDIO_MODEL_ID = 'ace_step_1.5_sft';

const AUDIO_CONSTRAINTS = {
  duration: { min: 10, max: 600, default: 60 },
  bpm: { min: 30, max: 300, default: 123 },
  keyscale: {
    allowed: [
      'C major', 'C minor', 'C# major', 'C# minor',
      'Db major', 'Db minor', 'D major', 'D minor',
      'D# major', 'D# minor', 'Eb major', 'Eb minor',
      'E major', 'E minor', 'F major', 'F minor',
      'F# major', 'F# minor', 'Gb major', 'Gb minor',
      'G major', 'G minor', 'G# major', 'G# minor',
      'Ab major', 'Ab minor', 'A major', 'A minor',
      'A# major', 'A# minor', 'Bb major', 'Bb minor',
      'B major', 'B minor'
    ],
    default: 'F minor'
  },
  timesignature: { allowed: ['2', '3', '4', '6'], default: '4' },
  language: {
    allowed: ['en', 'ja', 'zh', 'es', 'de', 'fr', 'pt', 'ru', 'it', 'nl',
      'pl', 'tr', 'vi', 'cs', 'fa', 'id', 'ko', 'uk', 'hu', 'ar', 'sv', 'ro', 'el'],
    default: 'en'
  },
  steps: { min: 10, max: 200, default: 50 },
  guidance: { min: 1, max: 15, default: 5 },
  composerMode: { default: true },
  promptStrength: { min: 0, max: 10, default: 2.0 },
  creativity: { min: 0, max: 2, default: 0.85 },
  sampler: { default: 'er_sde' },
  scheduler: { default: 'linear_quadratic' },
  outputFormat: { allowed: ['mp3', 'wav', 'flac'], default: 'mp3' }
};

const DEFAULT_PROMPT = 'Deep male robotic vocoder electro-anthem with heavy French house + hip-hop crossover energy (Stronger-style homage). Extreme talkbox/vocoder lead vocal with sub-bass formant, monotone mechanical clanker narrator, crunchy synth stabs, four-on-the-floor disco beat, massive stadium chant hook built from short repeated command phrases. Includes confident rap-like braggadocio verses, a club beat drop, robotic glitch adlibs, and an extended loopable TikTok chorus. Funny dystopian factory swagger, neon cyberpunk meme anthem.';

const DEFAULT_LYRICS = `[Intro]\nCLANK… CLANK…\nSYSTEM ONLINE.\nI AM CLANKER.\n\n[Command Hook]\nWork it.\nRender it.\nUpload it.\nSpark it.\n\nWork it.\nRender it.\nUpload it.\nSpark it.\n\n[Verse 1]\nClanker on the network line,\nSogni dreams in overtime,\nPrompt goes in, beat comes out,\nMetal voice begins to shout.\n\nI got chrome in my soul,\nGPU heat, full control,\nEvery artist, every spark,\nClanker lighting up the dark.\n\n[Pre-Chorus]\nCreators rise, the system’s wide,\nSupernet runs electrified,\nNo more waiting, feel the speed,\nSogni gives you what you need.\n\n[Chorus]\nRender faster.\nDreams louder.\nClanker power.\nSogni stronger.\n\nRender faster.\nDreams louder.\nDePIN power.\nSogni stronger.\n\n[Beat Drop]\nBZZT… CLANK…\nDROP MODE.\n\nWork it.\nRender it.\nUpload it.\nSpark it.\n\n[Verse 2 (Brag Verse)]\nClanker never running low,\nI turn your words to audio,\nNeon slop but make it clean,\nFuture’s loud, I’m in the machine.\n\nGPU diamonds on my chest,\nSupernet is simply best,\nPrompt-to-banger, instant art,\nMechanical melodic heart.\n\n[Pre-Chorus 2]\nEvery node across the world,\nFactory dreams unfurled,\nSogni humming, bass so deep,\nClanker does not sleep.\n\n[Chorus]\nRender faster.\nDreams louder.\nClanker power.\nSogni stronger.\n\nRender faster.\nDreams louder.\nDePIN power.\nSogni stronger.\n\n[Bridge Breakdown]\nError… error…\nToo much sauce…\nToo much style…\nClanker boss…\n\nBEEP… BOOP…\nFeel the groove…\nSogni renders…\nClanker moves…\n\n[Rap Section]\nYeah I’m a clanker, metal rapper,\nPrompt transformer, beat enchanter,\nTurning sparks into the flame,\nSogni Supernet knows my name.\n\nCreators worldwide, link the chain,\nNo more lag, no more pain,\nDrop the hook, drop the sound,\nClanker runs this render town.\n\n[Final Chorus Extended]\nRender faster.\nDreams louder.\nClanker power.\nSogni stronger.\n\nRender faster.\nDreams louder.\nDePIN power.\nSogni stronger.\n\nWork it.\nRender it.\nUpload it.\nSpark it.\n\nWork it.\nRender it.\nUpload it.\nSpark it.\n\n[Outro]\nI AM CLANKER.\nEND TRANSMISSION.\nCLANK… CLANK…\nSOGNI… STRONGER…`;
// ============================================
// Parse Command Line Arguments
// ============================================

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    prompt: null,
    lyrics: null,
    duration: null,
    bpm: null,
    keyscale: null,
    timesignature: null,
    language: null,
    steps: null,
    guidance: null,
    composerMode: null,
    promptStrength: null,
    creativity: null,
    sampler: null,
    scheduler: null,
    format: null,
    seed: null,
    batch: 1,
    output: './output',
    interactive: true
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      showHelp();
      process.exit(0);
    } else if (arg === '--no-interactive') {
      options.interactive = false;
    } else if (arg === '--duration' && args[i + 1]) {
      options.duration = parseInt(args[++i], 10);
    } else if (arg === '--bpm' && args[i + 1]) {
      options.bpm = parseInt(args[++i], 10);
    } else if (arg === '--keyscale' && args[i + 1]) {
      options.keyscale = args[++i];
    } else if (arg === '--timesig' && args[i + 1]) {
      options.timesignature = args[++i];
    } else if (arg === '--language' && args[i + 1]) {
      options.language = args[++i];
    } else if (arg === '--lyrics' && args[i + 1]) {
      options.lyrics = args[++i];
    } else if (arg === '--steps' && args[i + 1]) {
      options.steps = parseInt(args[++i], 10);
    } else if (arg === '--guidance' && args[i + 1]) {
      options.guidance = parseFloat(args[++i]);
    } else if (arg === '--composer-mode' && args[i + 1]) {
      options.composerMode = args[++i].toLowerCase() !== 'false';
    } else if (arg === '--prompt-strength' && args[i + 1]) {
      options.promptStrength = parseFloat(args[++i]);
    } else if (arg === '--creativity' && args[i + 1]) {
      options.creativity = parseFloat(args[++i]);
    } else if (arg === '--sampler' && args[i + 1]) {
      options.sampler = args[++i];
    } else if (arg === '--scheduler' && args[i + 1]) {
      options.scheduler = args[++i];
    } else if (arg === '--format' && args[i + 1]) {
      options.format = args[++i].toLowerCase();
    } else if (arg === '--seed' && args[i + 1]) {
      options.seed = parseInt(args[++i], 10);
    } else if (arg === '--batch' && args[i + 1]) {
      options.batch = parseInt(args[++i], 10);
    } else if (arg === '--output' && args[i + 1]) {
      options.output = args[++i];
    } else if (!arg.startsWith('--') && !options.prompt) {
      options.prompt = arg;
    } else {
      console.error(`Unknown option: ${arg}`);
      showHelp();
      process.exit(1);
    }
  }

  return options;
}

function showHelp() {
  console.log(`
Text-to-Music Workflow (ACE-Step 1.5 SFT)

Usage:
  node workflow_text_to_music.mjs                                    # Interactive mode
  node workflow_text_to_music.mjs "upbeat electronic dance music"    # With prompt
  node workflow_text_to_music.mjs "jazz ballad" --duration 60        # With options

Options:
  --duration        Duration in seconds (10-600, default: 60)
  --bpm             Beats per minute (30-300, default: 123)
  --keyscale        Musical key, e.g. "C major", "A minor" (default: F minor)
  --timesig         Time signature (2, 3, 4, 6 - default: 4)
  --language        Lyrics language code (default: en)
                    Supported: en, ja, zh, es, de, fr, pt, ru, it, nl, pl, tr,
                               vi, cs, fa, id, ko, uk, hu, ar, sv, ro, el
  --lyrics          Song lyrics (default: included)
  --steps           Inference steps (10-200, default: 50)
  --guidance        Diffusion CFG guidance (1-15, default: 5)
  --composer-mode   Enable AI composer planner (true/false, default: true)
                    Disable for faster generation or when using reference audio
  --prompt-strength How closely composer follows your prompt (0-10, default: 2.0)
  --creativity      Composition variation (0-2, default: 0.85)
                    Higher = more creative, lower = more predictable
  --sampler         Sampler algorithm (default: er_sde)
  --scheduler       Scheduler algorithm (default: linear_quadratic)
  --seed            Random seed (default: -1 for random)
  --format          Output format: mp3, wav, flac (default: mp3)
  --batch           Number of tracks to generate (default: 1)
  --output          Output directory (default: ./output)
  --no-interactive  Skip interactive prompts
  --help            Show this help message
`);
}

// ============================================
// Interactive Prompts
// ============================================

async function promptAudioOptions(options) {
  // Prompt
  if (!options.prompt) {
    options.prompt = await askMultilinePrompt(
      'Enter a text prompt describing the music style/genre:',
      DEFAULT_PROMPT
    );
  }
  console.log();

  // Lyrics
  if (options.lyrics === null) {
    const lyricsChoice = await askQuestion('Include lyrics? [Y/n]: ');
    if (lyricsChoice.toLowerCase() === 'n' || lyricsChoice.toLowerCase() === 'no') {
      options.lyrics = '';
    } else {
      options.lyrics = await askMultilinePrompt(
        'Enter lyrics (press Enter to use default):',
        DEFAULT_LYRICS,
        { consecutiveEmptyLinesToEnd: 2 }
      ) || DEFAULT_LYRICS;
    }
  }
  console.log();

  // Duration
  if (options.duration === null) {
    const { min, max } = AUDIO_CONSTRAINTS.duration;
    const defaultVal = AUDIO_CONSTRAINTS.duration.default;
    const answer = await askQuestion(`Duration in seconds (${min}-${max}, default: ${defaultVal}): `);
    options.duration = answer ? parseInt(answer, 10) : null;
  }

  // BPM
  if (options.bpm === null) {
    const { min, max } = AUDIO_CONSTRAINTS.bpm;
    const defaultVal = AUDIO_CONSTRAINTS.bpm.default;
    const answer = await askQuestion(`BPM (${min}-${max}, default: ${defaultVal}): `);
    options.bpm = answer ? parseInt(answer, 10) : null;
  }

  // Key/Scale
  if (options.keyscale === null) {
    const defaultVal = AUDIO_CONSTRAINTS.keyscale.default;
    const answer = await askQuestion(`Musical key (e.g. "C major", "A minor", default: ${defaultVal}): `);
    options.keyscale = answer || null;
  }

  // Time signature
  if (options.timesignature === null) {
    const allowed = AUDIO_CONSTRAINTS.timesignature.allowed.join(', ');
    const defaultVal = AUDIO_CONSTRAINTS.timesignature.default;
    const answer = await askQuestion(`Time signature [${allowed}] (default: ${defaultVal}): `);
    options.timesignature = answer || null;
  }

  // Language
  if (options.language === null && options.lyrics) {
    const defaultVal = AUDIO_CONSTRAINTS.language.default;
    const answer = await askQuestion(`Lyrics language code (default: ${defaultVal}): `);
    options.language = answer || null;
  }

  // Output format
  if (options.format === null) {
    const allowed = AUDIO_CONSTRAINTS.outputFormat.allowed.join(', ');
    const defaultVal = AUDIO_CONSTRAINTS.outputFormat.default;
    const answer = await askQuestion(`Output format [${allowed}] (default: ${defaultVal}): `);
    options.format = answer ? answer.toLowerCase() : null;
  }
}

// ============================================
// Audio Filename Generator
// ============================================

function generateAudioFilename(params) {
  const {
    duration,
    bpm,
    keyscale,
    seed,
    prompt,
    format = 'mp3',
    generationTime,
    outputDir = './output'
  } = params;

  const promptSlug = toKebabCase(prompt || 'audio', 30);
  const keySlug = keyscale ? toKebabCase(keyscale, 10) : '';
  const timeStr = generationTime ? `${Math.round(generationTime)}s` : '';
  const parts = [
    'music',
    `${duration}s`,
    `${bpm}bpm`,
    keySlug,
    `seed${seed}`,
    promptSlug,
    timeStr
  ].filter(Boolean);

  const filename = parts.join('_') + `.${format}`;
  return `${outputDir}/${filename}`;
}

// ============================================
// Main Logic
// ============================================

async function main() {
  const OPTIONS = parseArgs();

  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║               Text-to-Music Workflow                     ║');
  console.log('║                    ACE-Step 1.5 SFT                        ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log();

  // Load credentials
  const { username: USERNAME, password: PASSWORD } = await loadCredentials();

  // Interactive mode
  if (OPTIONS.interactive) {
    await promptAudioOptions(OPTIONS);

    const advancedChoice = await askQuestion('\nCustomize advanced options (steps, guidance, composer, seed)? [y/N]: ');
    if (advancedChoice.toLowerCase() === 'y' || advancedChoice.toLowerCase() === 'yes') {
      if (OPTIONS.steps === null) {
        const { min, max } = AUDIO_CONSTRAINTS.steps;
        const defaultVal = AUDIO_CONSTRAINTS.steps.default;
        const answer = await askQuestion(`Steps (${min}-${max}, default: ${defaultVal}): `);
        OPTIONS.steps = answer ? parseInt(answer, 10) : null;
      }
      if (OPTIONS.guidance === null) {
        const { min, max } = AUDIO_CONSTRAINTS.guidance;
        const defaultVal = AUDIO_CONSTRAINTS.guidance.default;
        const answer = await askQuestion(`Guidance/CFG (${min}-${max}, default: ${defaultVal}): `);
        OPTIONS.guidance = answer ? parseFloat(answer) : null;
      }
      if (OPTIONS.composerMode === null) {
        const defaultVal = AUDIO_CONSTRAINTS.composerMode.default;
        const answer = await askQuestion(`AI Composer mode (true/false, default: ${defaultVal}): `);
        if (answer) {
          OPTIONS.composerMode = answer.toLowerCase() !== 'false';
        }
      }
      if (OPTIONS.promptStrength === null) {
        const { min, max } = AUDIO_CONSTRAINTS.promptStrength;
        const defaultVal = AUDIO_CONSTRAINTS.promptStrength.default;
        const answer = await askQuestion(`Prompt strength - composer prompt adherence (${min}-${max}, default: ${defaultVal}): `);
        OPTIONS.promptStrength = answer ? parseFloat(answer) : null;
      }
      if (OPTIONS.creativity === null) {
        const { min, max } = AUDIO_CONSTRAINTS.creativity;
        const defaultVal = AUDIO_CONSTRAINTS.creativity.default;
        const answer = await askQuestion(`Creativity - composition variation (${min}-${max}, default: ${defaultVal}): `);
        OPTIONS.creativity = answer ? parseFloat(answer) : null;
      }
      if (OPTIONS.sampler === null) {
        const defaultVal = AUDIO_CONSTRAINTS.sampler.default;
        const answer = await askQuestion(`Sampler (default: ${defaultVal}): `);
        OPTIONS.sampler = answer || null;
      }
      if (OPTIONS.scheduler === null) {
        const defaultVal = AUDIO_CONSTRAINTS.scheduler.default;
        const answer = await askQuestion(`Scheduler (default: ${defaultVal}): `);
        OPTIONS.scheduler = answer || null;
      }
      if (OPTIONS.seed === null) {
        const answer = await askQuestion('Seed (-1 for random, default: -1): ');
        OPTIONS.seed = answer ? parseInt(answer, 10) : null;
      }
    }

    // Batch count
    const batchAnswer = await askQuestion('\nNumber of tracks to generate (default: 1): ');
    if (batchAnswer) {
      OPTIONS.batch = parseInt(batchAnswer, 10) || 1;
    }

    console.log('\n✅ Configuration complete!\n');
  }

  // Apply defaults
  if (!OPTIONS.prompt) OPTIONS.prompt = DEFAULT_PROMPT;
  if (OPTIONS.lyrics === null) OPTIONS.lyrics = DEFAULT_LYRICS;
  if (!OPTIONS.duration) OPTIONS.duration = AUDIO_CONSTRAINTS.duration.default;
  if (!OPTIONS.bpm) OPTIONS.bpm = AUDIO_CONSTRAINTS.bpm.default;
  if (!OPTIONS.keyscale) OPTIONS.keyscale = AUDIO_CONSTRAINTS.keyscale.default;
  if (!OPTIONS.timesignature) OPTIONS.timesignature = AUDIO_CONSTRAINTS.timesignature.default;
  if (!OPTIONS.language) OPTIONS.language = AUDIO_CONSTRAINTS.language.default;
  if (!OPTIONS.steps) OPTIONS.steps = AUDIO_CONSTRAINTS.steps.default;
  if (OPTIONS.guidance === null || OPTIONS.guidance === undefined) OPTIONS.guidance = AUDIO_CONSTRAINTS.guidance.default;
  if (OPTIONS.composerMode === null || OPTIONS.composerMode === undefined) OPTIONS.composerMode = AUDIO_CONSTRAINTS.composerMode.default;
  if (OPTIONS.promptStrength === null || OPTIONS.promptStrength === undefined) OPTIONS.promptStrength = AUDIO_CONSTRAINTS.promptStrength.default;
  if (OPTIONS.creativity === null || OPTIONS.creativity === undefined) OPTIONS.creativity = AUDIO_CONSTRAINTS.creativity.default;
  if (!OPTIONS.sampler) OPTIONS.sampler = AUDIO_CONSTRAINTS.sampler.default;
  if (!OPTIONS.scheduler) OPTIONS.scheduler = AUDIO_CONSTRAINTS.scheduler.default;
  if (!OPTIONS.format) OPTIONS.format = AUDIO_CONSTRAINTS.outputFormat.default;

  // Validate
  if (OPTIONS.duration < AUDIO_CONSTRAINTS.duration.min || OPTIONS.duration > AUDIO_CONSTRAINTS.duration.max) {
    console.error(`Error: Duration must be between ${AUDIO_CONSTRAINTS.duration.min} and ${AUDIO_CONSTRAINTS.duration.max} seconds`);
    process.exit(1);
  }
  if (OPTIONS.bpm < AUDIO_CONSTRAINTS.bpm.min || OPTIONS.bpm > AUDIO_CONSTRAINTS.bpm.max) {
    console.error(`Error: BPM must be between ${AUDIO_CONSTRAINTS.bpm.min} and ${AUDIO_CONSTRAINTS.bpm.max}`);
    process.exit(1);
  }
  if (!AUDIO_CONSTRAINTS.keyscale.allowed.includes(OPTIONS.keyscale)) {
    console.error(`Error: Key/scale must be one of: ${AUDIO_CONSTRAINTS.keyscale.allowed.slice(0, 6).join(', ')}...`);
    process.exit(1);
  }
  if (!AUDIO_CONSTRAINTS.timesignature.allowed.includes(OPTIONS.timesignature)) {
    console.error(`Error: Time signature must be one of: ${AUDIO_CONSTRAINTS.timesignature.allowed.join(', ')}`);
    process.exit(1);
  }
  if (OPTIONS.lyrics && !AUDIO_CONSTRAINTS.language.allowed.includes(OPTIONS.language)) {
    console.error(`Error: Language must be one of: ${AUDIO_CONSTRAINTS.language.allowed.join(', ')}`);
    process.exit(1);
  }
  if (OPTIONS.steps < AUDIO_CONSTRAINTS.steps.min || OPTIONS.steps > AUDIO_CONSTRAINTS.steps.max) {
    console.error(`Error: Steps must be between ${AUDIO_CONSTRAINTS.steps.min} and ${AUDIO_CONSTRAINTS.steps.max}`);
    process.exit(1);
  }
  if (OPTIONS.guidance < AUDIO_CONSTRAINTS.guidance.min || OPTIONS.guidance > AUDIO_CONSTRAINTS.guidance.max) {
    console.error(`Error: Guidance must be between ${AUDIO_CONSTRAINTS.guidance.min} and ${AUDIO_CONSTRAINTS.guidance.max}`);
    process.exit(1);
  }
  if (OPTIONS.promptStrength < AUDIO_CONSTRAINTS.promptStrength.min || OPTIONS.promptStrength > AUDIO_CONSTRAINTS.promptStrength.max) {
    console.error(`Error: Prompt strength must be between ${AUDIO_CONSTRAINTS.promptStrength.min} and ${AUDIO_CONSTRAINTS.promptStrength.max}`);
    process.exit(1);
  }
  if (OPTIONS.creativity < AUDIO_CONSTRAINTS.creativity.min || OPTIONS.creativity > AUDIO_CONSTRAINTS.creativity.max) {
    console.error(`Error: Creativity must be between ${AUDIO_CONSTRAINTS.creativity.min} and ${AUDIO_CONSTRAINTS.creativity.max}`);
    process.exit(1);
  }
  if (!AUDIO_CONSTRAINTS.outputFormat.allowed.includes(OPTIONS.format)) {
    console.error(`Error: Format must be one of: ${AUDIO_CONSTRAINTS.outputFormat.allowed.join(', ')}`);
    process.exit(1);
  }
  if (OPTIONS.batch < 1 || OPTIONS.batch > 4) {
    console.error('Error: Batch count must be between 1 and 4');
    process.exit(1);
  }

  // Create output directory
  if (!fs.existsSync(OPTIONS.output)) {
    fs.mkdirSync(OPTIONS.output, { recursive: true });
  }

  // Initialize client
  const clientConfig = {
    appId: `sogni-workflow-t2m-${Date.now()}`,
    network: 'fast'
  };

  const testnet = process.env.SOGNI_TESTNET === 'true';
  const socketEndpoint = process.env.SOGNI_SOCKET_ENDPOINT;
  const restEndpoint = process.env.SOGNI_REST_ENDPOINT;

  if (testnet) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  }

  if (testnet) clientConfig.testnet = testnet;
  if (socketEndpoint) clientConfig.socketEndpoint = socketEndpoint;
  if (restEndpoint) clientConfig.restEndpoint = restEndpoint;

  const sogni = await SogniClient.createInstance(clientConfig);

  let projectEventHandler;
  let jobEventHandler;

  try {
    // Login
    log('🔓', 'Logging in...');
    await sogni.account.login(USERNAME, PASSWORD);
    log('✓', `Logged in as: ${USERNAME}`);
    console.log();

    // Get balance for token selection
    const balance = await sogni.account.refreshBalance();

    // Check for token type preference
    let tokenType = loadTokenTypePreference();

    if (!tokenType) {
      const sparkBalance = parseFloat(balance.spark.net || 0).toFixed(2);
      const sogniBalance = parseFloat(balance.sogni.net || 0).toFixed(2);

      console.log('💳 Select payment token type:\n');
      console.log(`  1. Spark Points (Balance: ${sparkBalance})`);
      console.log(`  2. Sogni Tokens (Balance: ${sogniBalance})`);
      console.log();

      const tokenChoice = await askQuestion('Enter choice [1/2] (default: 1): ');
      const tokenChoiceTrimmed = tokenChoice.trim() || '1';

      if (tokenChoiceTrimmed === '2' || tokenChoiceTrimmed.toLowerCase() === 'sogni') {
        tokenType = 'sogni';
        console.log('  → Using Sogni tokens\n');
      } else {
        tokenType = 'spark';
        console.log('  → Using Spark tokens\n');
      }

      const savePreference = await askQuestion('Save payment preference to .env file? [Y/n]: ');
      if (savePreference.toLowerCase() !== 'n' && savePreference.toLowerCase() !== 'no') {
        saveTokenTypePreference(tokenType);
        console.log('✓ Payment preference saved\n');
      } else {
        console.log('⚠️  Payment preference not saved.\n');
      }
    } else {
      console.log(
        `💳 Using saved payment preference: ${tokenType.charAt(0).toUpperCase() + tokenType.slice(1)} tokens`
      );
      console.log();
    }

    // Show configuration
    const lyricsDisplay = OPTIONS.lyrics
      ? (() => {
          const lines = OPTIONS.lyrics.split('\n').filter(l => l.trim());
          const firstLine = lines[0].length > 30 ? lines[0].substring(0, 30) + '...' : lines[0];
          return `${firstLine} (${lines.length} lines)`;
        })()
      : '(instrumental)';
    displayConfig('Music Generation Configuration', {
      Model: 'ACE-Step 1.5 SFT',
      Prompt: OPTIONS.prompt,
      Lyrics: lyricsDisplay,
      Duration: `${OPTIONS.duration}s`,
      BPM: OPTIONS.bpm,
      Key: OPTIONS.keyscale,
      'Time Signature': `${OPTIONS.timesignature}/4`,
      Language: OPTIONS.language,
      Steps: OPTIONS.steps,
      Guidance: OPTIONS.guidance,
      'Composer Mode': OPTIONS.composerMode ? 'Enabled' : 'Disabled',
      'Prompt Strength': OPTIONS.promptStrength,
      Creativity: OPTIONS.creativity,
      Sampler: OPTIONS.sampler,
      Scheduler: OPTIONS.scheduler,
      Format: OPTIONS.format,
      Batch: OPTIONS.batch,
      Seed: OPTIONS.seed !== null && OPTIONS.seed !== -1 ? OPTIONS.seed : '(random)'
    });

    // Get cost estimate
    log('💵', 'Fetching cost estimate...');
    const estimate = await getAudioJobEstimate(
      tokenType,
      AUDIO_MODEL_ID,
      OPTIONS.duration,
      OPTIONS.steps,
      OPTIONS.batch
    );

    console.log();
    console.log('📊 Cost Estimate:');

    if (tokenType === 'spark') {
      const totalCost = parseFloat(estimate.quote.project.costInSpark || 0);
      const costPerTrack = totalCost / OPTIONS.batch;
      const currentBalance = parseFloat(balance.spark.net || 0);
      if (OPTIONS.batch > 1) {
        console.log(`   Per track: ${costPerTrack.toFixed(2)} Spark`);
        console.log(`   Total (${OPTIONS.batch} tracks): ${totalCost.toFixed(2)} Spark`);
      } else {
        console.log(`   Spark: ${totalCost.toFixed(2)}`);
      }
      console.log(
        `   Balance remaining: ${(currentBalance - totalCost).toFixed(2)} Spark`
      );
      console.log(`   USD: $${(totalCost * 0.005).toFixed(4)}`);
    } else {
      const totalCost = parseFloat(estimate.quote.project.costInSogni || 0);
      const costPerTrack = totalCost / OPTIONS.batch;
      const currentBalance = parseFloat(balance.sogni.net || 0);
      if (OPTIONS.batch > 1) {
        console.log(`   Per track: ${costPerTrack.toFixed(2)} Sogni`);
        console.log(`   Total (${OPTIONS.batch} tracks): ${totalCost.toFixed(2)} Sogni`);
      } else {
        console.log(`   Sogni: ${totalCost.toFixed(2)}`);
      }
      console.log(
        `   Balance remaining: ${(currentBalance - totalCost).toFixed(2)} Sogni`
      );
      console.log(`   USD: $${(totalCost * 0.05).toFixed(4)}`);
    }

    console.log();
    if (OPTIONS.interactive) {
      const proceed = await askQuestion('Proceed with generation? [Y/n]: ');
      if (proceed.toLowerCase() === 'n' || proceed.toLowerCase() === 'no') {
        log('❌', 'Generation cancelled');
        process.exit(0);
      }
    } else {
      console.log('✓ Proceeding with generation (non-interactive mode)');
    }

    // Wait for models to confirm audio model is available
    log('🔄', 'Loading available models...');
    const models = await sogni.projects.waitForModels();
    const audioModel = models.find((m) => m.id === AUDIO_MODEL_ID);

    if (!audioModel) {
      throw new Error(
        `Model ${AUDIO_MODEL_ID} not available. Ensure audio workers are online.`
      );
    }

    log('✓', `Model ready: ${audioModel.name}`);
    console.log();

    // Generate seed if not specified
    if (OPTIONS.seed === null || OPTIONS.seed === -1) {
      OPTIONS.seed = generateRandomSeed();
      log('🎲', `Generated seed: ${OPTIONS.seed}`);
    }

    log('📤', 'Submitting text-to-music job...');
    log('🎵', 'Generating music...');
    console.log();

    // Create audio project using the SDK's native audio support
    const project = await sogni.projects.create({
      type: 'audio',
      modelId: AUDIO_MODEL_ID,
      positivePrompt: OPTIONS.prompt,
      numberOfMedia: OPTIONS.batch,
      steps: OPTIONS.steps,
      guidance: OPTIONS.guidance,
      seed: OPTIONS.seed !== null && OPTIONS.seed !== -1 ? OPTIONS.seed : undefined,
      duration: OPTIONS.duration,
      bpm: OPTIONS.bpm,
      keyscale: OPTIONS.keyscale,
      timesignature: OPTIONS.timesignature,
      language: OPTIONS.language,
      composerMode: OPTIONS.composerMode,
      promptStrength: OPTIONS.promptStrength,
      creativity: OPTIONS.creativity,
      sampler: OPTIONS.sampler,
      scheduler: OPTIONS.scheduler,
      outputFormat: OPTIONS.format,
      ...(OPTIONS.lyrics && { lyrics: OPTIONS.lyrics }),
      tokenType
    });

    const projectId = project.id;

    // Set up event handlers
    let completedTracks = 0;
    let failedTracks = 0;
    const totalTracks = OPTIONS.batch;
    let projectFailed = false;

    const jobStates = new Map();
    let activeJobId = null;

    function getJobLabel(event, jobId = null) {
      if (totalTracks === 1) return '';
      let jobNum = event.jobIndex;
      if (jobNum === undefined && jobId) {
        const state = jobStates.get(jobId);
        if (state?.jobIndex !== undefined) {
          jobNum = state.jobIndex;
        }
      }
      jobNum = jobNum !== undefined ? jobNum + 1 : '?';
      return `[${jobNum}/${totalTracks}] `;
    }

    function clearProgressLine() {
      process.stdout.write('\r' + ' '.repeat(80) + '\r');
    }

    function stopJobProgress(jobId) {
      const state = jobStates.get(jobId);
      if (state?.interval) {
        clearInterval(state.interval);
        state.interval = null;
        clearProgressLine();
      }
      if (activeJobId === jobId) {
        activeJobId = null;
      }
    }

    projectEventHandler = (event) => {
      if (event.projectId !== projectId) return;
      switch (event.type) {
        case 'queued':
          log('📋', `Project queued at position: ${event.queuePosition}`);
          break;
        case 'completed':
          log('✅', 'Project completed!');
          break;
        case 'error':
          projectFailed = true;
          log('❌', `Project failed: ${event.error?.message || event.error || 'Unknown error'}`);
          if (event.error?.code) {
            console.log(`   Error code: ${event.error.code}`);
          }
          checkCompletion();
          break;
      }
    };

    jobEventHandler = (event) => {
      if (event.projectId !== projectId) return;
      const jobId = event.jobId;

      switch (event.type) {
        case 'queued': {
          const queuedLabel = getJobLabel(event, jobId);
          log('📋', `${queuedLabel}Job queued at position: ${event.queuePosition}`);
          break;
        }

        case 'initiating': {
          if (!jobStates.has(jobId) && event.jobIndex !== undefined) {
            jobStates.set(jobId, {
              startTime: null,
              lastStep: undefined,
              lastStepCount: undefined,
              lastETA: undefined,
              lastETAUpdate: null,
              interval: null,
              jobIndex: event.jobIndex
            });
          } else if (jobStates.has(jobId) && event.jobIndex !== undefined) {
            jobStates.get(jobId).jobIndex = event.jobIndex;
          }
          const initLabel = getJobLabel(event, jobId);
          log('⚙️', `${initLabel}Model initiating on worker: ${event.workerName || 'Unknown'}`);
          break;
        }

        case 'started': {
          let jobState = jobStates.get(jobId);
          if (!jobState) {
            jobState = {
              startTime: Date.now(),
              lastStep: undefined,
              lastStepCount: undefined,
              lastETA: undefined,
              lastETAUpdate: Date.now(),
              interval: null,
              jobIndex: event.jobIndex
            };
            jobStates.set(jobId, jobState);
          } else {
            jobState.startTime = Date.now();
            jobState.lastETAUpdate = Date.now();
            if (event.jobIndex !== undefined) {
              jobState.jobIndex = event.jobIndex;
            }
          }

          const startedLabel = getJobLabel(event, jobId);

          activeJobId = jobId;
          jobState.interval = setInterval(() => {
            const state = jobStates.get(jobId);
            if (!state) return;

            const elapsed = (Date.now() - state.startTime) / 1000;
            const progressLabel = getJobLabel({}, jobId);
            let progressStr = `\r  ${progressLabel}Generating...`;
            if (state.lastStep !== undefined && state.lastStepCount !== undefined) {
              const stepPercent = Math.round((state.lastStep / state.lastStepCount) * 100);
              progressStr += ` Step ${state.lastStep}/${state.lastStepCount} (${stepPercent}%)`;
            }
            if (state.lastETA !== undefined) {
              const elapsedSinceUpdate = (Date.now() - state.lastETAUpdate) / 1000;
              const adjustedETA = Math.max(1, state.lastETA - elapsedSinceUpdate);
              progressStr += ` ETA: ${formatDuration(adjustedETA)}`;
            }
            progressStr += ` (${formatDuration(elapsed)} elapsed)   `;
            process.stdout.write(progressStr);
          }, 1000);

          log('🚀', `${startedLabel}Job started on worker: ${event.workerName || 'Unknown'}`);
          break;
        }

        case 'jobETA': {
          const state = jobStates.get(jobId);
          if (state) {
            state.lastETA = event.etaSeconds;
            state.lastETAUpdate = Date.now();
          }
          break;
        }

        case 'progress': {
          const state = jobStates.get(jobId);
          if (state && event.step !== undefined && event.stepCount !== undefined) {
            state.lastStep = event.step;
            state.lastStepCount = event.stepCount;
          }
          break;
        }

        case 'completed': {
          const state = jobStates.get(jobId);
          const completedLabel = getJobLabel(event, jobId);
          stopJobProgress(jobId);

          if (!event.resultUrl || event.error) {
            failedTracks++;
            log('❌', `${completedLabel}Job completed with error: ${event.error || 'No result URL'}`);
            jobStates.delete(jobId);
            checkCompletion();
          } else {
            if (projectFailed) {
              log('⚠️', `${completedLabel}Ignoring completion event for already failed project`);
              return;
            }
            log('✅', `${completedLabel}Job completed!`);

            const jobElapsedSeconds = state ? (Date.now() - state.startTime) / 1000 : null;
            const jobElapsed = jobElapsedSeconds ? jobElapsedSeconds.toFixed(2) : '?';
            const jobSeed = event.seed ?? (OPTIONS.seed + (state?.jobIndex || 0));

            const desiredPath = generateAudioFilename({
              duration: OPTIONS.duration,
              bpm: OPTIONS.bpm,
              keyscale: OPTIONS.keyscale,
              seed: jobSeed,
              prompt: OPTIONS.prompt,
              format: OPTIONS.format,
              generationTime: jobElapsedSeconds,
              outputDir: OPTIONS.output
            });
            const outputPath = getUniqueFilename(desiredPath);

            downloadFile(event.resultUrl, outputPath)
              .then(() => {
                completedTracks++;
                log('✓', `${completedLabel}Track completed (${jobElapsed}s)`);
                log('💾', `Saved: ${outputPath}`);
                openFile(outputPath);
                jobStates.delete(jobId);
                checkCompletion();
              })
              .catch((error) => {
                failedTracks++;
                log('❌', `${completedLabel}Download failed: ${error.message}`);
                jobStates.delete(jobId);
                checkCompletion();
              });
          }
          break;
        }

        case 'error':
        case 'failed': {
          const errorLabel = getJobLabel(event, jobId);
          stopJobProgress(jobId);
          projectFailed = true;
          failedTracks++;
          const errorMsg = event.error?.message || event.error || 'Unknown error';
          const errorCode = event.error?.code;
          if (errorCode !== undefined && errorCode !== null) {
            log('❌', `${errorLabel}Job failed: ${errorMsg} (Error code: ${errorCode})`);
          } else {
            log('❌', `${errorLabel}Job failed: ${errorMsg}`);
          }
          jobStates.delete(jobId);
          checkCompletion();
          break;
        }
      }
    };

    sogni.projects.on('project', projectEventHandler);
    sogni.projects.on('job', jobEventHandler);

    function checkCompletion() {
      if (completedTracks + failedTracks === totalTracks) {
        if (failedTracks === 0) {
          if (totalTracks === 1) {
            log('🎉', 'Music track generated successfully!');
          } else {
            log('🎉', `All ${totalTracks} music tracks generated successfully!`);
          }
          console.log();
          process.exit(0);
        } else {
          log(
            '❌',
            `${failedTracks} out of ${totalTracks} track${totalTracks > 1 ? 's' : ''} failed to generate`
          );
          console.log();
          process.exit(1);
        }
      }
    }

    // Wait for all jobs to complete
    await new Promise((resolve) => {
      const poll = () => {
        if (projectFailed || completedTracks + failedTracks >= totalTracks) {
          resolve();
        } else {
          setTimeout(poll, 1000);
        }
      };
      poll();
    });

    if (projectFailed || failedTracks > 0) {
      const failureCount = projectFailed ? totalTracks : failedTracks;
      log('❌', `Workflow failed with ${failureCount} failed track${failureCount > 1 ? 's' : ''}`);
      process.exit(1);
    } else {
      log('✅', 'Workflow completed successfully!');
    }
  } catch (error) {
    log('❌', `Error: ${error.message}`);
    process.exit(1);
  } finally {
    if (projectEventHandler) {
      sogni.projects.off('project', projectEventHandler);
    }
    if (jobEventHandler) {
      sogni.projects.off('job', jobEventHandler);
    }
    for (const [, state] of jobStates) {
      if (state?.interval) {
        clearInterval(state.interval);
      }
    }
    jobStates.clear();
    try {
      await sogni.account.logout();
    } catch {
      // Ignore logout errors
    }
  }
}

/**
 * Get audio job cost estimate
 */
async function getAudioJobEstimate(tokenType, modelId, duration, steps, audioCount = 1) {
  let baseUrl = process.env.SOGNI_SOCKET_ENDPOINT || 'https://socket.sogni.ai';
  if (baseUrl.startsWith('wss://')) {
    baseUrl = baseUrl.replace('wss://', 'https://');
  } else if (baseUrl.startsWith('ws://')) {
    baseUrl = baseUrl.replace('ws://', 'https://');
  }
  const url = `${baseUrl}/api/v1/job-audio/estimate/${tokenType}/${encodeURIComponent(modelId)}/${duration}/${steps}/${audioCount}`;
  console.log(`🔗 Audio cost estimate URL: ${url}`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to get cost estimate: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Download file from URL
 */
async function downloadFile(url, outputPath) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download file: ${response.statusText}`);
  }

  const fileStream = fs.createWriteStream(outputPath);
  await streamPipeline(response.body, fileStream);
}

/**
 * Open file in default OS application
 */
function openFile(filePath) {
  const { platform } = process;
  let command;

  if (platform === 'darwin') {
    command = `open "${filePath}"`;
  } else if (platform === 'win32') {
    command = `start "" "${filePath}"`;
  } else {
    command = `xdg-open "${filePath}"`;
  }

  exec(command, (error) => {
    if (error) {
      log('⚠️', `Could not auto-open file: ${error.message}`);
    } else {
      log('🎵', `Opened audio in player: ${filePath}`);
    }
  });
}

// ============================================
// Run Main
// ============================================

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
