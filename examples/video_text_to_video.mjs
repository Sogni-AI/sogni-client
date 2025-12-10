#!/usr/bin/env node
/**
 * Text-to-Video Example with Balance & Cost Confirmation
 *
 * This script generates a video from a text prompt using the Sogni Client SDK.
 * It displays your account balance and requires confirmation before spending tokens.
 *
 * Prerequisites:
 * - Edit USERNAME and PASSWORD in the script
 * - You need access to the 'fast' network for video generation
 *
 * Usage:
 *   node video_text_to_video.mjs "your prompt here"
 *   node video_text_to_video.mjs "your prompt" --width 768 --height 768
 *   node video_text_to_video.mjs "your prompt" --fps 32 --frames 161
 *   node video_text_to_video.mjs "your prompt" --seed 12345
 *
 * Options:
 *   --width   Video width (default: 512)
 *   --height  Video height (default: 512)
 *   --fps     Frames per second: 16 or 32 (default: 16)
 *   --frames  Number of frames, 17-161 (default: 81 = 5 seconds at 16fps)
 *   --model   Model ID (default: prompts for speed/quality)
 *   --output  Output directory (default: ./videos)
 *   --seed    Random seed for reproducibility (default: random)
 *   --help    Show this help message
 */

import { SogniClient } from '../dist/index.js';
import * as fs from 'node:fs';
import { pipeline } from 'node:stream';
import { promisify } from 'node:util';
import { exec } from 'node:child_process';
import * as readline from 'node:readline';

const streamPipeline = promisify(pipeline);

// Model variants
const MODELS = {
  t2v: {
    speed: 'wan_v2.2-14b-fp8_t2v_lightx2v',
    quality: 'wan_v2.2-14b-fp8_t2v'
  }
};

// ============================================
// Parse Command Line Arguments
// ============================================

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    prompt: null,
    width: 512,
    height: 512,
    fps: 16,
    frames: 81,
    model: null, // Will prompt for speed/quality if not specified
    modelExplicit: false,
    output: './videos',
    seed: Math.floor(Math.random() * 2147483647) // Random seed by default
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (arg === '--help' || arg === '-h') {
      console.log(`
Usage: node video_text_to_video.mjs "your prompt" [options]

Options:
  --width <n>    Video width (default: 512)
  --height <n>   Video height (default: 512)
  --fps <n>      Frames per second: 16 or 32 (default: 16)
  --frames <n>   Number of frames, 17-161 (default: 81 = 5s at 16fps)
  --model <id>   Model ID (prompts for speed/quality if not specified)
  --output <dir> Output directory (default: ./videos)
  --seed <n>     Random seed for reproducibility (default: random)
  --help         Show this help message

Models:
  Speed:   wan_v2.2-14b-fp8_t2v_lightx2v (faster, good quality)
  Quality: wan_v2.2-14b-fp8_t2v (slower, best quality)

Examples:
  node video_text_to_video.mjs "A cat playing piano"
  node video_text_to_video.mjs "A sunset over mountains" --width 768 --height 512
  node video_text_to_video.mjs "Ocean waves" --fps 32 --frames 161
  node video_text_to_video.mjs "A robot" --seed 12345
`);
      process.exit(0);
    } else if (arg === '--width' && args[i + 1]) {
      options.width = parseInt(args[++i], 10);
    } else if (arg === '--height' && args[i + 1]) {
      options.height = parseInt(args[++i], 10);
    } else if (arg === '--fps' && args[i + 1]) {
      options.fps = parseInt(args[++i], 10);
    } else if (arg === '--frames' && args[i + 1]) {
      options.frames = parseInt(args[++i], 10);
    } else if (arg === '--model' && args[i + 1]) {
      options.model = args[++i];
      options.modelExplicit = true;
    } else if (arg === '--output' && args[i + 1]) {
      options.output = args[++i];
    } else if (arg === '--seed' && args[i + 1]) {
      options.seed = parseInt(args[++i], 10);
    } else if (!arg.startsWith('--') && !options.prompt) {
      options.prompt = arg;
    }
    i++;
  }

  // Validate
  if (!options.prompt) {
    console.error('Error: Prompt is required');
    console.error('Usage: node video_text_to_video.mjs "your prompt" [options]');
    console.error('Use --help for more information');
    process.exit(1);
  }

  return options;
}

const OPTIONS = parseArgs();

// ============================================
// Configuration
// ============================================

const USERNAME = '';
const PASSWORD = '';

let VIDEO_MODEL_ID = OPTIONS.model; // May be set later by prompt
const VIDEO_CONFIG = {
  frames: OPTIONS.frames,
  fps: OPTIONS.fps
};
const WIDTH = OPTIONS.width;
const HEIGHT = OPTIONS.height;
const POSITIVE_PROMPT = OPTIONS.prompt;
const OUTPUT_DIR = OPTIONS.output;
const SEED = OPTIONS.seed;

// ============================================
// Interactive Prompts
// ============================================

async function askSpeedOrQuality() {
  // If model was explicitly set, use it
  if (OPTIONS.modelExplicit) {
    return OPTIONS.model;
  }

  // If not TTY, default to speed
  if (!process.stdin.isTTY) {
    return MODELS.t2v.speed;
  }

  console.log('\n⚡ Select generation mode:\n');
  console.log('  1. Speed   - Faster generation, good quality (LightX2V)');
  console.log('  2. Quality - Slower generation, best quality');
  console.log();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question('Enter choice [1/2] (default: 1): ', (answer) => {
      rl.close();
      const choice = answer.trim() || '1';
      if (choice === '2' || choice.toLowerCase() === 'quality' || choice.toLowerCase() === 'q') {
        console.log('  → Using Quality mode\n');
        resolve(MODELS.t2v.quality);
      } else {
        console.log('  → Using Speed mode\n');
        resolve(MODELS.t2v.speed);
      }
    });
  });
}

/**
 * Ask a question via readline
 */
function askQuestion(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim() || '');
    });
  });
}

// ============================================
// Helper Functions
// ============================================

function log(emoji, message) {
  console.log(`${emoji} ${message}`);
}

function formatDuration(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function ensureOutputDir() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
}

async function downloadFile(url, filename) {
  ensureOutputDir();
  const savePath = `${OUTPUT_DIR}/${filename}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download: ${response.statusText}`);
  }
  await streamPipeline(response.body, fs.createWriteStream(savePath));
  return savePath;
}

function openFile(filePath) {
  const command =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  exec(`${command} "${filePath}"`, (error) => {
    if (error) {
      log('⚠️', `Could not auto-open file: ${error.message}`);
    }
  });
}

/**
 * Get video job cost estimate
 */
async function getVideoJobEstimate(tokenType, modelId, width, height, frames, fps) {
  const url = `https://socket.sogni.ai/api/v1/job-video/estimate/${tokenType}/${encodeURIComponent(modelId)}/${width}/${height}/${frames}/${fps}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to get cost estimate: ${response.statusText}`);
  }
  return response.json();
}

// ============================================
// Main
// ============================================

async function main() {
  console.log();
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║           Sogni Text-to-Video (with SDK)                ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log();

  // Check for credentials
  if (!USERNAME || !PASSWORD) {
    console.error('❌ Error: USERNAME and PASSWORD must be configured');
    console.error('   Edit the script and set your credentials at the top of the file.');
    console.error();
    process.exit(1);
  }

  // Prompt for model if not specified
  if (!VIDEO_MODEL_ID) {
    VIDEO_MODEL_ID = await askSpeedOrQuality();
  }

  // Initialize client (point to local with testnet for debug logging)
  const APP_ID = `${USERNAME || 'user'}-t2v-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  console.log(`\n🔎 Using appId: ${APP_ID}\n`);
  const client = await SogniClient.createInstance({
    // add random suffix to avoid 4015 duplicate app-id boots
    appId: APP_ID,
    network: 'fast'
  });

  let projectEventHandler;
  let jobEventHandler;

  try {
    // Login
    log('🔓', 'Logging in...');
    await client.account.login(USERNAME, PASSWORD);
    log('✓', `Logged in as: ${USERNAME}`);
    console.log();

    // Display balance
    const balance = await client.account.refreshBalance();
    console.log('💰 Account Balance:');
    console.log(`   Sogni: ${parseFloat(balance.sogni.net || 0).toFixed(2)}`);
    console.log(`   Spark: ${parseFloat(balance.spark.net || 0).toFixed(2)}`);
    console.log();

    // Get cost estimate
    log('💵', 'Fetching cost estimate...');
    const estimate = await getVideoJobEstimate(
      'spark',
      VIDEO_MODEL_ID,
      WIDTH,
      HEIGHT,
      VIDEO_CONFIG.frames,
      VIDEO_CONFIG.fps
    );

    console.log();
    console.log('📊 Cost Estimate:');
    console.log(`   Sogni: ${parseFloat(estimate.quote.project.costInSogni || 0).toFixed(2)}`);
    console.log(`   Spark: ${parseFloat(estimate.quote.project.costInSpark || 0).toFixed(2)}`);
    console.log(`   USD: $${parseFloat(estimate.quote.project.costInUSD || 0).toFixed(4)}`);
    console.log();

    // Ask for confirmation
    const proceed = await askQuestion('Proceed with generation? [Y/n]: ');
    if (proceed.toLowerCase() === 'n' || proceed.toLowerCase() === 'no') {
      log('❌', 'Job cancelled by user');
      await client.account.logout();
      process.exit(0);
    }

    console.log();

    // Display configuration
    const boxWidth = 57;
    const labelWidth = 14;
    console.log('┌─────────────────────────────────────────────────────────┐');
    console.log('│ Video Configuration                                     │');
    console.log('├─────────────────────────────────────────────────────────┤');
    console.log(
      `│ ${'Model:'.padEnd(labelWidth)}${VIDEO_MODEL_ID.padEnd(boxWidth - labelWidth - 2)} │`
    );
    console.log(
      `│ ${'Resolution:'.padEnd(labelWidth)}${(WIDTH + 'x' + HEIGHT).padEnd(boxWidth - labelWidth - 2)} │`
    );
    console.log(
      `│ ${'Frames:'.padEnd(labelWidth)}${String(VIDEO_CONFIG.frames).padEnd(boxWidth - labelWidth - 2)} │`
    );
    console.log(
      `│ ${'Duration:'.padEnd(labelWidth)}${(Math.floor((VIDEO_CONFIG.frames - 1) / VIDEO_CONFIG.fps) + 's at ' + VIDEO_CONFIG.fps + 'fps').padEnd(boxWidth - labelWidth - 2)} │`
    );
    console.log(
      `│ ${'Seed:'.padEnd(labelWidth)}${String(SEED).padEnd(boxWidth - labelWidth - 2)} │`
    );
    console.log('└─────────────────────────────────────────────────────────┘');
    console.log();
    console.log('📝 Prompt:');
    console.log(`   ${POSITIVE_PROMPT}`);
    console.log();

    // Wait for models
    log('🔄', 'Loading available models...');
    const models = await client.projects.waitForModels();
    const videoModel = models.find((m) => m.id === VIDEO_MODEL_ID);

    if (!videoModel) {
      throw new Error(`Model ${VIDEO_MODEL_ID} not available`);
    }

    log('✓', `Model ready: ${videoModel.name}`);
    console.log();

    // Create project
    log('📤', 'Submitting video generation job...');
    log('⏳', '(This may take several minutes)');
    console.log();

    const startTime = Date.now();
    const project = await client.projects.create({
      type: 'video',
      modelId: VIDEO_MODEL_ID,
      positivePrompt: POSITIVE_PROMPT,
      negativePrompt: '',
      stylePrompt: '',
      numberOfMedia: 1,
      seed: SEED,
      width: WIDTH,
      height: HEIGHT,
      frames: VIDEO_CONFIG.frames,
      fps: VIDEO_CONFIG.fps,
      tokenType: 'spark'
    });

    projectEventHandler = (event) => {
      if (event.projectId !== project.id) return;
      switch (event.type) {
        case 'queued':
          log('📋', `Job queued at position: ${event.queuePosition}`);
          break;
        case 'completed':
          log('✅', 'Project completed!');
          break;
        case 'error':
          log('❌', `Project failed: ${event.error.message}`);
          break;
      }
    };

    jobEventHandler = (event) => {
      if (event.projectId !== project.id) return;
      switch (event.type) {
        case 'initiating':
          log('⚙️', `Model initiating on worker: ${event.workerName || 'Unknown'}`);
          break;
        case 'started':
          log('🚀', `Job started on worker: ${event.workerName || 'Unknown'}`);
          break;
        case 'progress': {
          const elapsed = (Date.now() - startTime) / 1000;
          const pct = Math.min(100, Math.max(0, Math.floor((event.step / event.stepCount) * 100)));
          const filled = Math.floor(pct / 5);
          const bar = '█'.repeat(filled) + '░'.repeat(20 - filled);
          process.stdout.write(`\r  Progress: [${bar}] ${pct}% - Step ${event.step}/${event.stepCount} (${formatDuration(elapsed)} elapsed)   `);
          break;
        }
        case 'jobETA': {
          const elapsed = (Date.now() - startTime) / 1000;
          const etaFormatted = formatDuration(event.etaSeconds);
          process.stdout.write(`\r  Generating... ETA: ${etaFormatted} (${formatDuration(elapsed)} elapsed)   `);
          break;
        }
        case 'completed':
          log('✅', 'Job completed!');
          break;
        case 'error':
          log('❌', `Job failed: ${event.error.message}`);
          break;
      }
    };

    client.projects.on('project', projectEventHandler);
    client.projects.on('job', jobEventHandler);

    // Wait for completion
    const resultUrls = await project.waitForCompletion();
    console.log();
    console.log();

    // Download video (first result)
    const videoUrl = resultUrls[0];

    log('📥', 'Downloading video...');
    const filename = `video_${project.id}_1.mp4`;
    const savePath = await downloadFile(videoUrl, filename);

    console.log();
    log('✅', 'Video generation complete!');
    log('📁', `Saved to: ${savePath}`);

    const elapsed = (Date.now() - startTime) / 1000;
    log('⏱️', `Total time: ${formatDuration(elapsed)}`);

    // Open the video
    log('🎬', 'Opening video...');
    openFile(savePath);

    // Cleanup handled in finally

  } catch (error) {
    console.error(error);
    log('❌', `Error: ${error.message}`);
    process.exit(1);
  } finally {
    if (projectEventHandler) {
      client.projects.off('project', projectEventHandler);
    }
    if (jobEventHandler) {
      client.projects.off('job', jobEventHandler);
    }
    try {
      await client.account.logout();
    } catch {
      // Ignore logout errors
    }
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
