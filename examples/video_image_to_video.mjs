#!/usr/bin/env node
/**
 * Image-to-Video Example with Balance & Cost Confirmation
 *
 * This script generates a video from an input image using the Sogni Client SDK.
 * It displays your account balance and requires confirmation before spending tokens.
 *
 * Prerequisites:
 * - Edit USERNAME and PASSWORD in the script
 * - You need access to the 'fast' network for video generation
 *
 * Usage:
 *   node video_image_to_video.mjs --image input.png
 *   node video_image_to_video.mjs --image input.png "camera pans left"
 *   node video_image_to_video.mjs --image input.png "zoom in" --width 768 --height 768
 *   node video_image_to_video.mjs --image input.png --fps 32 --frames 161
 *
 * Options:
 *   --image   Input image path (required, or will prompt to select)
 *   --width   Video width (default: auto-detect from image)
 *   --height  Video height (default: auto-detect from image)
 *   --fps     Frames per second: 16 or 32 (default: 16)
 *   --frames  Number of frames, 17-161 (default: 81 = 5 seconds at 16fps)
 *   --model   Model ID (default: prompts for speed/quality)
 *   --output  Output directory (default: ./videos)
 *   --seed    Random seed for reproducibility (default: random)
 *   --help    Show this help message
 */

import { SogniClient } from '../dist/index.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pipeline } from 'node:stream';
import { promisify } from 'node:util';
import { exec } from 'node:child_process';
import * as readline from 'node:readline';
import imageSize from 'image-size';

const streamPipeline = promisify(pipeline);

// Model variants
const MODELS = {
  i2v: {
    speed: 'wan_v2.2-14b-fp8_i2v_lightx2v',
    quality: 'wan_v2.2-14b-fp8_i2v'
  }
};

// ============================================
// Parse Command Line Arguments
// ============================================

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    prompt: '',
    image: null,
    width: null, // Will auto-detect if not specified
    height: null, // Will auto-detect if not specified
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
Usage: node video_image_to_video.mjs [prompt] [options]

Options:
  --image <path> Input image path (required, or will prompt to select)
  --width <n>    Video width (default: auto-detect from image)
  --height <n>   Video height (default: auto-detect from image)
  --fps <n>      Frames per second: 16 or 32 (default: 16)
  --frames <n>   Number of frames, 17-161 (default: 81 = 5s at 16fps)
  --model <id>   Model ID (prompts for speed/quality if not specified)
  --output <dir> Output directory (default: ./videos)
  --seed <n>     Random seed for reproducibility (default: random)
  --help         Show this help message

Models:
  Speed:   wan_v2.2-14b-fp8_i2v_lightx2v (faster, good quality)
  Quality: wan_v2.2-14b-fp8_i2v (slower, best quality)

Examples:
  node video_image_to_video.mjs --image cat.jpg "camera pans left"
  node video_image_to_video.mjs --image landscape.png "zoom in" --width 768 --height 512
  node video_image_to_video.mjs --image photo.jpg --fps 32 --frames 161
`);
      process.exit(0);
    } else if (arg === '--image' && args[i + 1]) {
      options.image = args[++i];
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
let WIDTH = OPTIONS.width; // May be auto-detected
let HEIGHT = OPTIONS.height; // May be auto-detected
const POSITIVE_PROMPT = OPTIONS.prompt;
const INPUT_IMAGE = OPTIONS.image;
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
    return MODELS.i2v.speed;
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
        resolve(MODELS.i2v.quality);
      } else {
        console.log('  → Using Speed mode\n');
        resolve(MODELS.i2v.speed);
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

/**
 * Interactively pick an image file from current directory
 */
async function pickImageFile(defaultImage) {
  // If image was provided via CLI, use it
  if (defaultImage && fs.existsSync(defaultImage)) {
    return defaultImage;
  }

  // If input.png exists, use it
  if (fs.existsSync('input.png')) {
    log('🖼️', 'Found input.png, using as source image');
    return 'input.png';
  }

  // If not TTY, error out
  if (!process.stdin.isTTY) {
    throw new Error(
      'No input image specified. Use --image <path> or place input.png in current directory.'
    );
  }

  // List available image files
  const imageFiles = fs
    .readdirSync('.')
    .filter((f) => /\.(jpg|jpeg|png|webp|gif)$/i.test(f))
    .sort();

  if (imageFiles.length === 0) {
    throw new Error(
      'No image files found in current directory. Use --image <path> to specify an image.'
    );
  }

  console.log('\n🖼️  Select an image file:\n');
  imageFiles.forEach((file, i) => {
    console.log(`  ${i + 1}. ${file}`);
  });
  console.log();

  const answer = await askQuestion(`Enter choice [1-${imageFiles.length}]: `);
  const choice = parseInt(answer, 10);

  if (isNaN(choice) || choice < 1 || choice > imageFiles.length) {
    throw new Error('Invalid choice');
  }

  const selectedFile = imageFiles[choice - 1];
  console.log(`  → Using ${selectedFile}\n`);
  return selectedFile;
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
  console.log('║         Sogni Image-to-Video (with SDK)                 ║');
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

  // Pick image file
  const imagePath = await pickImageFile(INPUT_IMAGE);
  const resolvedImagePath = path.resolve(imagePath);

  if (!fs.existsSync(resolvedImagePath)) {
    throw new Error(`Image file not found: ${resolvedImagePath}`);
  }

  log('🖼️', `Input image: ${resolvedImagePath}`);
  console.log();

  // Auto-detect dimensions if not specified
  if (!WIDTH || !HEIGHT) {
    try {
      const dimensions = imageSize(resolvedImagePath);
      if (dimensions.width && dimensions.height) {
        WIDTH = OPTIONS.width || dimensions.width;
        HEIGHT = OPTIONS.height || dimensions.height;
        log('📐', `Auto-detected dimensions: ${WIDTH}x${HEIGHT}`);
      } else {
        log('⚠️', 'Could not auto-detect image dimensions, using defaults.');
        WIDTH = WIDTH || 512;
        HEIGHT = HEIGHT || 512;
      }
    } catch (e) {
      log('❌', `Error reading image dimensions: ${e.message}, using defaults.`);
      WIDTH = WIDTH || 512;
      HEIGHT = HEIGHT || 512;
    }
  }

  // Initialize client (point to local with testnet for debug logging)
  const APP_ID = `${USERNAME || 'user'}-i2v-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  console.log(`\n🔎 Using appId: ${APP_ID}\n`);
  const client = await SogniClient.createInstance({
    // add random suffix to avoid 4015 duplicate app-id boots
    appId: APP_ID,
    network: 'fast',
    logLevel: 'info'
  });

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
      'sogni',
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
      await client.disconnect();
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
    console.log(`   ${POSITIVE_PROMPT || '(no prompt - animate existing image)'}`);
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

    // Read image buffer
    const imageBuffer = fs.readFileSync(resolvedImagePath);

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
      referenceImage: imageBuffer, // Pass the image buffer directly
      frames: VIDEO_CONFIG.frames,
      fps: VIDEO_CONFIG.fps
    });

    // Handle progress events
    client.apiClient.socket.on('jobState', (event) => {
      switch (event.type) {
        case 'queued':
          log('📋', `Job queued at position: ${event.queuePosition}`);
          break;
        case 'initiatingModel':
          log('⚙️', `Model initiating on worker: ${event.workerName}`);
          break;
        case 'jobStarted':
          log('🚀', `Job started on worker: ${event.workerName}`);
          break;
        case 'jobCompleted':
          log('✅', 'Job completed!');
          break;
      }
    });

    client.apiClient.socket.on('jobProgress', (event) => {
      const elapsed = (Date.now() - startTime) / 1000;
      const pct = Math.min(100, Math.max(0, Math.floor((event.step / event.stepCount) * 100)));
      const filled = Math.floor(pct / 5);
      const bar = '█'.repeat(filled) + '░'.repeat(20 - filled);
      process.stdout.write(
        `\r  Progress: [${bar}] ${pct}% - Step ${event.step}/${event.stepCount} (${formatDuration(elapsed)} elapsed)   `
      );
    });

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

    // Cleanup
    await client.disconnect();
  } catch (error) {
    console.error();
    log('❌', `Error: ${error.message}`);
    try {
      await client.disconnect();
    } catch {
      // Ignore disconnect errors
    }
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
