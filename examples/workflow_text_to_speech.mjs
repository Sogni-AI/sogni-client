#!/usr/bin/env node
/**
 * Text-to-Speech Workflow
 *
 * Reads a script aloud with Qwen3-TTS, in one of three modes. They are three
 * different checkpoints rather than three presets of one, so each takes its own
 * inputs and refuses the others:
 *
 *   voice   Pick one of nine studio voices. `--instruct` optionally restyles the
 *           delivery ("whispering, close to the mic") without changing who is
 *           speaking.
 *   clone   Copy a voice from 3-30s of reference audio. Pass `--reference` and,
 *           ideally, `--reference-text`: with the transcript the model conditions
 *           on the recording itself instead of on the speaker embedding alone,
 *           which lands markedly closer to the source.
 *   design  Invent a speaker who does not exist from `--instruct` alone, with no
 *           recording at all.
 *
 * Speech is priced per 1000 characters of script, floored at a per-render
 * minimum — it is the words, not a requested duration, that decide the cost.
 *
 * Prerequisites:
 * - Set SOGNI_API_KEY or SOGNI_USERNAME/SOGNI_PASSWORD in .env file (or will prompt)
 * - Speech workers must be available on the Fast network (Relaxed carries none)
 *
 * Usage:
 *   node workflow_text_to_speech.mjs                                  # Interactive
 *   node workflow_text_to_speech.mjs "Good evening."                  # Studio voice
 *   node workflow_text_to_speech.mjs "Guten Abend." --voice ryan --language german
 *   node workflow_text_to_speech.mjs "Good evening." --instruct "whispering, close to the mic"
 *   node workflow_text_to_speech.mjs "Good evening." --mode clone \
 *     --reference ./voice.wav --reference-text "what the clip says"
 *   node workflow_text_to_speech.mjs "Good evening." --mode design \
 *     --instruct "a warm, unhurried narrator in her forties with a faint Scottish lilt"
 *
 * Options:
 *   --mode            voice | clone | design (default: voice)
 *   --voice           Studio voice, `voice` mode only (default: serena)
 *   --instruct        Delivery direction (`voice`) or the speaker to invent (`design`)
 *   --reference       Path to 3-30s reference recording, `clone` mode only
 *   --reference-text  Exact transcript of --reference, `clone` mode only
 *   --language        Spoken language (default: auto)
 *   --format          mp3 | wav | flac (default: mp3)
 *   --batch           Number of takes (default: 1)
 *   --output          Output directory (default: ./output)
 *   --help            Print supported voices, languages and limits
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { pipeline } from 'node:stream';
import { exec } from 'node:child_process';
import { SogniClient } from '@sogni-ai/sogni-client';
import {
  loadCredentials,
  loadTokenTypePreference,
  saveTokenTypePreference
} from './credentials.mjs';

const streamPipeline = promisify(pipeline);

// The three checkpoints, and what each one will and will not accept. Sending an
// input a mode does not take is refused rather than ignored, so the CLI checks
// before spending a round trip.
const MODES = {
  voice: {
    modelId: 'qwen3_tts_1.7b_custom_voice_bf16',
    label: 'Studio voice',
    voices: true,
    instruct: 'optional',
    reference: false
  },
  clone: {
    modelId: 'qwen3_tts_1.7b_voice_clone_bf16',
    label: 'Voice clone',
    voices: false,
    instruct: 'unsupported',
    reference: true
  },
  design: {
    modelId: 'qwen3_tts_1.7b_voice_design_bf16',
    label: 'Voice design',
    voices: false,
    instruct: 'required',
    reference: false
  }
};

// Every voice speaks all ten languages; the accent is what changes between them.
const VOICES = {
  serena: 'female, English',
  vivian: 'female, Chinese',
  uncle_fu: 'male, Chinese',
  ryan: 'male, English',
  aiden: 'male, English',
  ono_anna: 'female, Japanese',
  sohee: 'female, Korean',
  eric: 'male, English',
  dylan: 'male, English'
};

const LANGUAGES = [
  'auto',
  'english',
  'chinese',
  'japanese',
  'korean',
  'german',
  'french',
  'russian',
  'portuguese',
  'spanish',
  'italian'
];

const FORMATS = ['mp3', 'wav', 'flac'];
const MAX_SCRIPT_CHARS = 4096;
const MAX_INSTRUCT_CHARS = 512;
const MAX_REFERENCE_TEXT_CHARS = 1024;
const REFERENCE_SECONDS = { min: 3, max: 30 };

const DEFAULT_SCRIPT =
  'Good evening. This is Sogni, reading a line back to you in a voice you chose.';

function log(icon, message) {
  console.log(`${icon} ${message}`);
}

function printHelp() {
  console.log(`
Text-to-Speech (Qwen3-TTS)

Modes:
${Object.entries(MODES)
  .map(([id, m]) => `  ${id.padEnd(7)} ${m.label.padEnd(14)} ${m.modelId}`)
  .join('\n')}

Studio voices (--voice, 'voice' mode only):
${Object.entries(VOICES)
  .map(([id, desc]) => `  ${id.padEnd(10)} ${desc}`)
  .join('\n')}

Languages (--language): ${LANGUAGES.join(', ')}
Formats (--format):    ${FORMATS.join(', ')}

Limits:
  Script            up to ${MAX_SCRIPT_CHARS} characters
  Direction         up to ${MAX_INSTRUCT_CHARS} characters
  Reference text    up to ${MAX_REFERENCE_TEXT_CHARS} characters
  Reference audio   ${REFERENCE_SECONDS.min}-${REFERENCE_SECONDS.max} seconds (longer is trimmed)

Pricing: per 1000 characters of script, floored at a per-render minimum.
`);
}

function parseArgs(argv) {
  const options = {
    mode: 'voice',
    voice: 'serena',
    instruct: null,
    reference: null,
    referenceText: null,
    language: 'auto',
    format: 'mp3',
    batch: 1,
    output: './output',
    script: null
  };

  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
      case '--mode':
        options.mode = argv[++i];
        break;
      case '--voice':
        options.voice = argv[++i];
        break;
      case '--instruct':
        options.instruct = argv[++i];
        break;
      case '--reference':
        options.reference = argv[++i];
        break;
      case '--reference-text':
        options.referenceText = argv[++i];
        break;
      case '--language':
        options.language = argv[++i];
        break;
      case '--format':
        options.format = argv[++i];
        break;
      case '--batch':
        options.batch = parseInt(argv[++i], 10);
        break;
      case '--output':
        options.output = argv[++i];
        break;
      default:
        if (arg.startsWith('--')) {
          console.error(`Error: Unknown option ${arg}. Run with --help.`);
          process.exit(1);
        }
        positional.push(arg);
    }
  }
  if (positional.length) options.script = positional.join(' ');
  return options;
}

/**
 * Refuses a request the checkpoint would refuse, in the same terms.
 *
 * Every one of these is enforced server-side; saying so here is cheaper than a
 * round trip that ends in a rejection.
 */
function validate(options) {
  const mode = MODES[options.mode];
  if (!mode) return `Unknown mode: ${options.mode}. Use voice, clone or design.`;

  const script = (options.script || '').trim();
  if (!script) return 'A script is required — the words to speak.';
  if (script.length > MAX_SCRIPT_CHARS) {
    return `Scripts are limited to ${MAX_SCRIPT_CHARS} characters; this one is ${script.length}.`;
  }

  const instruct = (options.instruct || '').trim();
  if (instruct && mode.instruct === 'unsupported') {
    return `${mode.label} takes no style direction — drop --instruct.`;
  }
  if (!instruct && mode.instruct === 'required') {
    return `${mode.label} needs --instruct describing the speaker to invent.`;
  }
  if (instruct.length > MAX_INSTRUCT_CHARS) {
    return `The direction is limited to ${MAX_INSTRUCT_CHARS} characters; this one is ${instruct.length}.`;
  }

  if (mode.reference && !options.reference) {
    return `${mode.label} needs --reference pointing at ${REFERENCE_SECONDS.min}-${REFERENCE_SECONDS.max}s of the voice.`;
  }
  if (!mode.reference && options.reference) {
    return `${mode.label} takes no reference recording — drop --reference.`;
  }
  if (options.reference && !fs.statSync(options.reference, { throwIfNoEntry: false })?.isFile()) {
    return `Reference recording not found, or not a file: ${options.reference}`;
  }

  const referenceText = (options.referenceText || '').trim();
  if (referenceText && !mode.reference) {
    return `${mode.label} has nothing to transcribe — drop --reference-text.`;
  }
  if (referenceText.length > MAX_REFERENCE_TEXT_CHARS) {
    return `The reference transcript is limited to ${MAX_REFERENCE_TEXT_CHARS} characters; this one is ${referenceText.length}.`;
  }

  if (mode.voices && !VOICES[options.voice]) {
    return `Unknown voice: ${options.voice}. Run with --help for the roster.`;
  }
  if (!LANGUAGES.includes(options.language)) {
    return `Unsupported language: ${options.language}.`;
  }
  if (!FORMATS.includes(options.format)) {
    return `Unsupported format: ${options.format}.`;
  }
  if (!Number.isInteger(options.batch) || options.batch < 1 || options.batch > 16) {
    return 'Batch must be a whole number between 1 and 16.';
  }
  return null;
}

function slugify(text, max = 40) {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, max) || 'take'
  );
}

function uniqueFilename(desired) {
  if (!fs.existsSync(desired)) return desired;
  const { dir, name, ext } = path.parse(desired);
  let n = 2;
  let candidate = path.join(dir, `${name}-${n}${ext}`);
  while (fs.existsSync(candidate)) {
    n++;
    candidate = path.join(dir, `${name}-${n}${ext}`);
  }
  return candidate;
}

async function downloadFile(url, outputPath) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to download file: ${response.statusText}`);
  await streamPipeline(response.body, fs.createWriteStream(outputPath));
}

function openFile(filePath) {
  const command =
    process.platform === 'darwin'
      ? `open "${filePath}"`
      : process.platform === 'win32'
        ? `start "" "${filePath}"`
        : `xdg-open "${filePath}"`;
  exec(command, (error) => {
    if (error) log('⚠️', `Could not auto-open file: ${error.message}`);
    else log('🔊', `Opened audio in player: ${filePath}`);
  });
}

async function main() {
  const OPTIONS = parseArgs(process.argv.slice(2));
  if (!OPTIONS.script) OPTIONS.script = DEFAULT_SCRIPT;

  const invalid = validate(OPTIONS);
  if (invalid) {
    console.error(`Error: ${invalid}`);
    process.exit(1);
  }

  const mode = MODES[OPTIONS.mode];
  if (!fs.existsSync(OPTIONS.output)) fs.mkdirSync(OPTIONS.output, { recursive: true });

  const credentials = await loadCredentials();
  const clientConfig = {
    appId: `sogni-workflow-t2s-${Date.now()}`,
    // Speech ships in the CU13 opt-in worker pack, which only Fast carries.
    network: 'fast'
  };
  const socketEndpoint = process.env.SOGNI_SOCKET_ENDPOINT;
  const restEndpoint = process.env.SOGNI_REST_ENDPOINT;
  if (process.env.SOGNI_TESTNET === 'true') {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    clientConfig.testnet = true;
  }
  if (socketEndpoint) clientConfig.socketEndpoint = socketEndpoint;
  if (restEndpoint) clientConfig.restEndpoint = restEndpoint;
  if (credentials.apiKey) clientConfig.apiKey = credentials.apiKey;

  const sogni = await SogniClient.createInstance(clientConfig);

  try {
    if (!credentials.apiKey) {
      log('🔓', 'Logging in...');
      await sogni.account.login(credentials.username, credentials.password);
      log('✓', `Logged in as: ${credentials.username}`);
    } else {
      log('✓', 'Authenticated with API key');
    }

    let tokenType = loadTokenTypePreference();
    if (!tokenType) {
      tokenType = 'spark';
      saveTokenTypePreference(tokenType);
    }

    console.log();
    log('🗣️', `${mode.label} — ${mode.modelId}`);
    console.log(`   Script      : ${OPTIONS.script.slice(0, 60)}${OPTIONS.script.length > 60 ? '…' : ''}`);
    console.log(`   Characters  : ${OPTIONS.script.length} / ${MAX_SCRIPT_CHARS}`);
    if (mode.voices) console.log(`   Voice       : ${OPTIONS.voice} (${VOICES[OPTIONS.voice]})`);
    if (OPTIONS.instruct) console.log(`   Direction   : ${OPTIONS.instruct}`);
    if (OPTIONS.reference) console.log(`   Reference   : ${OPTIONS.reference}`);
    if (OPTIONS.referenceText) console.log(`   Transcript  : ${OPTIONS.referenceText.slice(0, 60)}`);
    console.log(`   Language    : ${OPTIONS.language}`);
    console.log(`   Format      : ${OPTIONS.format}`);
    console.log(`   Takes       : ${OPTIONS.batch}`);
    console.log();

    // Speech is billed per 1000 characters, so a quote is only honest if it
    // carries the script length. `projects.estimateAudioCost` has no
    // `characters` parameter yet, and without it every quote comes back at the
    // tier's 1000-character default — $0.42 for a one-line take that bills
    // about $0.07. So this asks the endpoint directly, on the same path the SDK
    // builds. Switch to the SDK method the moment it carries the parameter.
    try {
      const segments = [tokenType, mode.modelId, 30, 1, OPTIONS.batch]
        .map((segment) => encodeURIComponent(segment))
        .join('/');
      const response = await sogni.apiClient.socket.get(
        `/api/v1/job-audio/estimate/${segments}`,
        { characters: Math.max(OPTIONS.script.length, 1) }
      );
      const { project: quote } = response.quote;
      log(
        '💰',
        `Estimate: $${parseFloat(quote.costInUSD).toFixed(4)} ` +
          `(${parseFloat(quote.costInToken).toFixed(2)} ${tokenType}) ` +
          `for ${OPTIONS.script.length} characters`
      );
    } catch (error) {
      log('⚠️', `Could not fetch an estimate: ${error.message}`);
    }

    const project = await sogni.projects.create({
      type: 'audio',
      modelId: mode.modelId,
      tokenType,
      numberOfMedia: OPTIONS.batch,
      // The socket maps positivePrompt onto the spoken script for audio models.
      positivePrompt: OPTIONS.script,
      language: OPTIONS.language,
      outputFormat: OPTIONS.format,
      ...(mode.voices ? { speaker: OPTIONS.voice } : {}),
      ...(OPTIONS.instruct && mode.instruct !== 'unsupported'
        ? { instruct: OPTIONS.instruct }
        : {}),
      ...(mode.reference
        ? {
            referenceAudio: fs.readFileSync(OPTIONS.reference),
            ...(OPTIONS.referenceText ? { referenceText: OPTIONS.referenceText } : {})
          }
        : {})
    });

    log('🚀', `Project started: ${project.id}`);
    console.log();

    const started = Date.now();
    let completed = 0;
    let failed = 0;

    await new Promise((resolve) => {
      project.on('progress', (progress) => {
        if (OPTIONS.batch === 1) {
          process.stdout.write(`\r   Rendering… ${Math.round(progress)}%`);
        }
      });

      project.on('jobCompleted', async (job) => {
        if (OPTIONS.batch === 1) process.stdout.write('\r');
        const index = completed + failed + 1;
        if (!job.resultUrl) {
          failed++;
          log('❌', `Take ${index} finished without a result`);
        } else {
          const name = `speech-${OPTIONS.mode}-${slugify(OPTIONS.script)}-${index}.${OPTIONS.format}`;
          const outputPath = uniqueFilename(path.join(OPTIONS.output, name));
          try {
            await downloadFile(job.resultUrl, outputPath);
            completed++;
            log('✓', `Take ${index} saved: ${outputPath}`);
            if (OPTIONS.batch === 1) openFile(outputPath);
          } catch (error) {
            failed++;
            log('❌', `Take ${index} download failed: ${error.message}`);
          }
        }
        if (completed + failed >= OPTIONS.batch) resolve();
      });

      project.on('jobFailed', (job) => {
        failed++;
        log('❌', `A take failed: ${job.error?.message || job.error || 'unknown error'}`);
        if (completed + failed >= OPTIONS.batch) resolve();
      });

      project.on('failed', (error) => {
        log('❌', `Project failed: ${error?.message || error}`);
        resolve();
      });
    });

    console.log();
    log('🏁', `${completed} of ${OPTIONS.batch} take(s) in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    process.exit(failed && !completed ? 1 : 0);
  } catch (error) {
    console.error(`\nError: ${error.message}`);
    process.exit(1);
  }
}

main();
