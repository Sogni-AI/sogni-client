#!/usr/bin/env node
/**
 * Batch Image-to-Video Processor
 *
 * This script processes all images in the "toprocess" folder and generates videos
 * using the same settings for all files. It prompts once for settings and applies
 * them to all images.
 *
 * Prerequisites:
 * - Set SOGNI_USERNAME and SOGNI_PASSWORD in .env file (or will prompt)
 * - Place images in the "toprocess" folder
 * - You need access to the 'fast' network for video generation
 *
 * Usage:
 *   node video_batch_process.mjs
 *   node video_batch_process.mjs "camera pans left"
 *   node video_batch_process.mjs "zoom in" --width 768 --height 768
 *   node video_batch_process.mjs --fps 32 --frames 161
 *
 * Options:
 *   --width   Video width (default: auto-detect from first image)
 *   --height  Video height (default: auto-detect from first image)
 *   --fps     Frames per second: 16 or 32 (default: 16)
 *   --frames  Number of frames, 17-161 (default: 81 = 5 seconds at 16fps)
 *   --model   Model ID (default: prompts for speed/quality)
 *   --output  Output directory (default: ./videos)
 *   --seed    Random seed for reproducibility (default: random for each)
 *   --folder  Input folder path (default: ./toprocess)
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
import { loadCredentials, loadTokenTypePreference, saveTokenTypePreference } from './credentials.mjs';

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
    width: null, // Will auto-detect if not specified
    height: null, // Will auto-detect if not specified
    fps: 16,
    frames: 81,
    model: null, // Will prompt for speed/quality if not specified
    modelExplicit: false,
    output: './videos',
    seed: null, // Will generate random for each image
    folder: './toprocess'
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (arg === '--help' || arg === '-h') {
      console.log(`
Usage: node video_batch_process.mjs [prompt] [options]

Options:
  --width <n>     Video width (default: auto-detect from first image)
  --height <n>    Video height (default: auto-detect from first image)
  --fps <n>       Frames per second: 16 or 32 (default: 16)
  --frames <n>    Number of frames, 17-161 (default: 81 = 5s at 16fps)
  --model <id>    Model ID (prompts for speed/quality if not specified)
  --output <dir>  Output directory (default: ./videos)
  --seed <n>      Random seed for reproducibility (default: random for each)
  --folder <path> Input folder path (default: ./toprocess)
  --help          Show this help message

Models:
  Speed:   wan_v2.2-14b-fp8_i2v_lightx2v (faster, good quality)
  Quality: wan_v2.2-14b-fp8_i2v (slower, best quality)

Examples:
  node video_batch_process.mjs "camera pans left"
  node video_batch_process.mjs "zoom in" --width 768 --height 512
  node video_batch_process.mjs --fps 32 --frames 161 --folder ./myimages
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
    } else if (arg === '--folder' && args[i + 1]) {
      options.folder = args[++i];
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

let VIDEO_MODEL_ID = OPTIONS.model; // May be set later by prompt
const VIDEO_CONFIG = {
  frames: OPTIONS.frames,
  fps: OPTIONS.fps
};
let WIDTH = OPTIONS.width; // May be auto-detected
let HEIGHT = OPTIONS.height; // May be auto-detected
const POSITIVE_PROMPT = OPTIONS.prompt;
const OUTPUT_DIR = OPTIONS.output;
const INPUT_FOLDER = OPTIONS.folder;
const FIXED_SEED = OPTIONS.seed;

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

async function askFPS() {
  // If FPS was explicitly set via CLI, use it
  if (OPTIONS.fps && OPTIONS.fps !== 16) {
    return OPTIONS.fps;
  }

  // If not TTY, default to 16
  if (!process.stdin.isTTY) {
    return 16;
  }

  console.log('🎬 Select frame rate:\n');
  console.log('  1. 16 FPS - Standard, good for most uses');
  console.log('  2. 32 FPS - Smoother motion, higher quality');
  console.log();

  const answer = await askQuestion('Enter choice [1/2] (default: 1): ');
  const choice = answer.trim() || '1';

  if (choice === '2' || choice === '32') {
    console.log('  → Using 32 FPS\n');
    return 32;
  } else {
    console.log('  → Using 16 FPS\n');
    return 16;
  }
}

async function askVideoDuration(fps) {
  // If frames was explicitly set via CLI, use it
  if (OPTIONS.frames && OPTIONS.frames !== 81) {
    return OPTIONS.frames;
  }

  // If not TTY, default to 5 seconds
  if (!process.stdin.isTTY) {
    return fps === 32 ? 161 : 81;
  }

  console.log('⏱️  Select video duration:\n');
  console.log('  1. 2 seconds');
  console.log('  2. 3 seconds');
  console.log('  3. 4 seconds');
  console.log('  4. 5 seconds (default)');
  console.log('  5. 6 seconds');
  console.log('  6. 8 seconds');
  console.log('  7. 10 seconds');
  console.log('  8. Custom');
  console.log();

  const answer = await askQuestion('Enter choice [1-8] (default: 4): ');
  const choice = answer.trim() || '4';

  let seconds;
  switch(choice) {
    case '1': seconds = 2; break;
    case '2': seconds = 3; break;
    case '3': seconds = 4; break;
    case '4': seconds = 5; break;
    case '5': seconds = 6; break;
    case '6': seconds = 8; break;
    case '7': seconds = 10; break;
    case '8':
      const customAnswer = await askQuestion('Enter duration in seconds (1-10): ');
      seconds = Math.min(10, Math.max(1, parseInt(customAnswer, 10) || 5));
      break;
    default: seconds = 5;
  }

  // Calculate frames: (seconds * fps) + 1
  const frames = Math.min(161, Math.max(17, (seconds * fps) + 1));

  console.log(`  → ${seconds} seconds = ${frames} frames at ${fps} FPS\n`);
  return frames;
}

/**
 * Get all image files from the input folder
 */
function getImageFiles() {
  if (!fs.existsSync(INPUT_FOLDER)) {
    throw new Error(`Input folder not found: ${INPUT_FOLDER}`);
  }

  const files = fs
    .readdirSync(INPUT_FOLDER)
    .filter((f) => /\.(jpg|jpeg|png|webp)$/i.test(f))
    .sort()
    .map((f) => path.join(INPUT_FOLDER, f));

  return files;
}

/**
 * Check if video already exists for an image
 */
function videoExists(imageBasename, outputDir) {
  const videoPath = path.join(outputDir, `${imageBasename}.mp4`);
  return fs.existsSync(videoPath);
}

/**
 * Process a single image file with retry logic
 */
async function processImage(sogni, imagePath, imageIndex, totalImages, settings, retryCount = 0) {
  const filename = path.basename(imagePath);
  const fileBasename = path.basename(imagePath, path.extname(imagePath));

  console.log();
  console.log('━'.repeat(60));
  console.log(`📸 Processing image ${imageIndex + 1}/${totalImages}: ${filename}`);
  console.log('━'.repeat(60));
  console.log();

  // Read image buffer
  const imageBuffer = fs.readFileSync(imagePath);

  // Generate random seed if not fixed
  const seed = settings.fixedSeed || Math.floor(Math.random() * 2147483647);

  // Auto-detect dimensions if needed for this specific image
  let width = settings.width;
  let height = settings.height;

  if (!width || !height) {
    try {
      const dimensions = imageSize(imagePath);
      if (dimensions.width && dimensions.height) {
        width = width || dimensions.width;
        height = height || dimensions.height;
        log('📐', `Image dimensions: ${width}x${height}`);
      }
    } catch (e) {
      log('⚠️', 'Could not detect image dimensions, using defaults.');
      width = width || 512;
      height = height || 512;
    }
  }

  // Display configuration for this image
  console.log('┌─────────────────────────────────────────────────────────┐');
  console.log('│ Configuration for this image                            │');
  console.log('├─────────────────────────────────────────────────────────┤');
  console.log(`│ Resolution: ${width}x${height}`.padEnd(59) + ' │');
  console.log(`│ Seed: ${seed}`.padEnd(59) + ' │');
  if (retryCount > 0) {
    console.log(`│ Retry attempt: ${retryCount}/3`.padEnd(59) + ' │');
  }
  console.log('└─────────────────────────────────────────────────────────┘');
  console.log();

  // Create project
  log('📤', 'Submitting video generation job...');

  const startTime = Date.now();

  // Event handlers for this specific job
  let projectEventHandler;
  let jobEventHandler;
  let projectCompleted = false;
  let projectError = null;

  try {
    const project = await sogni.projects.create({
      type: 'video',
      modelId: settings.modelId,
      positivePrompt: settings.prompt || '',
      negativePrompt: '',
      stylePrompt: '',
      numberOfMedia: 1,
      seed: seed,
      width: width,
      height: height,
      referenceImage: imageBuffer,
      frames: settings.frames,
      fps: settings.fps,
      tokenType: 'spark'
    });

    log('📝', `Project ID: ${project.id}`);

    projectEventHandler = (event) => {
      if (event.projectId !== project.id) return;
      switch (event.type) {
        case 'queued':
          log('📋', `Job queued at position: ${event.queuePosition}`);
          break;
        case 'completed':
          log('✅', 'Project completed!');
          projectCompleted = true;
          break;
        case 'error':
          log('❌', `Project failed: ${event.error?.message || 'Unknown error'}`);
          projectError = event.error;
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
          process.stdout.write(
            `\r  Progress: [${bar}] ${pct}% - Step ${event.step}/${event.stepCount} (${formatDuration(elapsed)} elapsed)   `
          );
          break;
        }
        case 'jobETA': {
          const elapsed = (Date.now() - startTime) / 1000;
          const etaFormatted = formatDuration(event.etaSeconds);
          process.stdout.write(
            `\r  Generating... ETA: ${etaFormatted} (${formatDuration(elapsed)} elapsed)   `
          );
          break;
        }
        case 'completed':
          console.log(); // New line after progress
          log('✅', 'Job completed!');
          break;
        case 'error':
          console.log(); // New line after progress
          log('❌', `Job failed: ${event.error?.message || 'Unknown error'}`);
          projectError = event.error;
          break;
      }
    };

    sogni.projects.on('project', projectEventHandler);
    sogni.projects.on('job', jobEventHandler);

    // Wait for completion with timeout
    let resultUrls;
    try {
      resultUrls = await project.waitForCompletion();
    } catch (waitError) {
      // Check if it's a "Project not found" error and retry
      if (waitError.message?.includes('Project not found') || waitError.message?.includes('Project timed out')) {
        throw new Error('API_ERROR: ' + waitError.message);
      }
      throw waitError;
    }

    console.log();

    if (!resultUrls || resultUrls.length === 0) {
      throw new Error('No video URLs returned from project');
    }

    // Download video with the same name as the image
    const videoUrl = resultUrls[0];
    log('📥', 'Downloading video...');
    const videoFilename = `${fileBasename}.mp4`;
    const savePath = await downloadFile(videoUrl, videoFilename);

    log('✅', 'Video generation complete!');
    log('📁', `Saved to: ${savePath}`);

    const elapsed = (Date.now() - startTime) / 1000;
    log('⏱️', `Time for this video: ${formatDuration(elapsed)}`);

    return { success: true, path: savePath, time: elapsed };
  } catch (error) {
    console.log(); // New line if there was progress output

    // Check if we should retry
    if (error.message?.includes('API_ERROR') && retryCount < 3) {
      log('🔄', `Retrying due to API error (attempt ${retryCount + 1}/3)...`);

      // Wait a bit before retrying
      await new Promise(resolve => setTimeout(resolve, 5000 * (retryCount + 1)));

      // Retry with incremented count
      return processImage(sogni, imagePath, imageIndex, totalImages, settings, retryCount + 1);
    }

    log('❌', `Error processing ${filename}: ${error.message}`);
    return { success: false, error: error.message };
  } finally {
    // Clean up event handlers for this job
    if (projectEventHandler && sogni?.projects) {
      sogni.projects.off('project', projectEventHandler);
    }
    if (jobEventHandler && sogni?.projects) {
      sogni.projects.off('job', jobEventHandler);
    }
  }
}

// ============================================
// Main
// ============================================

async function main() {
  // Suppress noisy error logs from the SDK that occur after successful completion
  const originalConsoleError = console.error;
  console.error = (...args) => {
    const errorString = args.join(' ');
    // Suppress "Project not found" errors and WebSocket disconnect messages
    if (errorString.includes('Project not found') ||
        errorString.includes('ApiError') ||
        errorString.includes('WebSocket disconnected') ||
        errorString.includes('CloseEvent')) {
      return;
    }
    originalConsoleError.apply(console, args);
  };

  console.log();
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║       Sogni Batch Image-to-Video Processor              ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log();

  // Load credentials from .env or prompt user
  const { username: USERNAME, password: PASSWORD } = await loadCredentials();

  // Get all image files
  const imageFiles = getImageFiles();

  if (imageFiles.length === 0) {
    console.error(`❌ No image files found in folder: ${INPUT_FOLDER}`);
    process.exit(1);
  }

  // Check which videos already exist
  ensureOutputDir();
  const toProcess = [];
  const alreadyExists = [];

  for (const imagePath of imageFiles) {
    const fileBasename = path.basename(imagePath, path.extname(imagePath));
    const videoPath = path.join(OUTPUT_DIR, `${fileBasename}.mp4`);

    if (fs.existsSync(videoPath)) {
      alreadyExists.push(path.basename(imagePath));
    } else {
      toProcess.push(imagePath);
    }
  }

  console.log(`📂 Found ${imageFiles.length} image(s) in ${INPUT_FOLDER}`);

  if (alreadyExists.length > 0) {
    console.log(`⏭️  ${alreadyExists.length} video(s) already exist (will skip)`);
  }

  if (toProcess.length === 0) {
    console.log('\n✅ All videos have already been generated!');
    console.log('   Nothing to process. Remove videos from ./videos to regenerate.');
    process.exit(0);
  }

  console.log(`🎬 ${toProcess.length} video(s) to generate\n`);

  // Prompt for model if not specified
  if (!VIDEO_MODEL_ID) {
    VIDEO_MODEL_ID = await askSpeedOrQuality();
  }

  // Prompt for FPS if not specified
  VIDEO_CONFIG.fps = await askFPS();

  // Prompt for video duration
  VIDEO_CONFIG.frames = await askVideoDuration(VIDEO_CONFIG.fps);

  // Auto-detect dimensions from first image if not specified
  if (!WIDTH || !HEIGHT) {
    const firstImage = imageFiles[0];
    try {
      const dimensions = imageSize(firstImage);
      if (dimensions.width && dimensions.height) {
        WIDTH = WIDTH || dimensions.width;
        HEIGHT = HEIGHT || dimensions.height;
        log('📐', `Using dimensions from first image: ${WIDTH}x${HEIGHT}`);
        log('ℹ️', 'Note: Individual images may have different dimensions if auto-detected');
      }
    } catch (e) {
      log('⚠️', 'Could not auto-detect dimensions, will detect per image.');
    }
  }

  // Initialize client
  const APP_ID = `${USERNAME || 'user'}-batch-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  console.log(`\n🔎 Using appId: ${APP_ID}\n`);

  const sogni = await SogniClient.createInstance({
    appId: APP_ID,
    network: 'fast',
    logLevel: 'error'  // Changed from 'info' to reduce noise
  });

  try {
    // Login
    log('🔓', 'Logging in...');
    await sogni.account.login(USERNAME, PASSWORD);
    log('✓', `Logged in as: ${USERNAME}`);
    console.log();

    // Display balance
    const balance = await sogni.account.refreshBalance();
    console.log('💰 Account Balance:');
    console.log(`   Sogni: ${parseFloat(balance.sogni.net || 0).toFixed(2)}`);
    console.log(`   Spark: ${parseFloat(balance.spark.net || 0).toFixed(2)}`);
    console.log();

    // Get cost estimate for a single video
    log('💵', 'Fetching cost estimate per video...');
    const estimate = await getVideoJobEstimate(
      'spark',
      VIDEO_MODEL_ID,
      WIDTH || 512,
      HEIGHT || 512,
      VIDEO_CONFIG.frames,
      VIDEO_CONFIG.fps
    );

    console.log();
    console.log('📊 Cost Estimate (per video):');
    console.log(`   Sogni: ${parseFloat(estimate.quote.project.costInSogni || 0).toFixed(2)}`);
    console.log(`   Spark: ${parseFloat(estimate.quote.project.costInSpark || 0).toFixed(2)}`);
    console.log(`   USD: $${parseFloat(estimate.quote.project.costInUSD || 0).toFixed(4)}`);
    console.log();

    const totalCostSpark = parseFloat(estimate.quote.project.costInSpark || 0) * toProcess.length;
    const totalCostUSD = parseFloat(estimate.quote.project.costInUSD || 0) * toProcess.length;

    console.log(`💵 Total Cost Estimate (${toProcess.length} new videos):`);
    console.log(`   Total Spark: ${totalCostSpark.toFixed(2)}`);
    console.log(`   Total USD: $${totalCostUSD.toFixed(4)}`);
    console.log();

    // Display batch configuration
    console.log('┌─────────────────────────────────────────────────────────┐');
    console.log('│ Batch Configuration                                      │');
    console.log('├─────────────────────────────────────────────────────────┤');
    console.log(`│ Model: ${VIDEO_MODEL_ID}`.padEnd(59) + ' │');
    console.log(`│ Default Resolution: ${WIDTH || 'auto'}x${HEIGHT || 'auto'}`.padEnd(59) + ' │');
    console.log(`│ Frames: ${VIDEO_CONFIG.frames}`.padEnd(59) + ' │');
    console.log(`│ Duration: ${Math.floor((VIDEO_CONFIG.frames - 1) / VIDEO_CONFIG.fps)}s at ${VIDEO_CONFIG.fps}fps`.padEnd(59) + ' │');
    console.log(`│ Seed: ${FIXED_SEED || 'Random for each'}`.padEnd(59) + ' │');
    console.log(`│ To Process: ${toProcess.length} (${alreadyExists.length} skipped)`.padEnd(59) + ' │');
    console.log('└─────────────────────────────────────────────────────────┘');
    console.log();
    console.log('📝 Prompt:');
    console.log(`   ${POSITIVE_PROMPT || '(no prompt - animate existing images)'}`);
    console.log();

    // Ask for confirmation
    const proceed = await askQuestion(`Proceed with generation of ${toProcess.length} new video(s)? [Y/n]: `);
    if (proceed.toLowerCase() === 'n' || proceed.toLowerCase() === 'no') {
      log('❌', 'Batch processing cancelled by user');
      await sogni.account.logout();
      process.exit(0);
    }

    console.log();

    // Wait for models
    log('🔄', 'Loading available models...');
    const models = await sogni.projects.waitForModels();
    const videoModel = models.find((m) => m.id === VIDEO_MODEL_ID);

    if (!videoModel) {
      throw new Error(`Model ${VIDEO_MODEL_ID} not available`);
    }

    log('✓', `Model ready: ${videoModel.name}`);
    console.log();

    // Process all images
    const results = [];
    const settings = {
      modelId: VIDEO_MODEL_ID,
      prompt: POSITIVE_PROMPT,
      frames: VIDEO_CONFIG.frames,
      fps: VIDEO_CONFIG.fps,
      width: WIDTH,
      height: HEIGHT,
      fixedSeed: FIXED_SEED,
      outputDir: OUTPUT_DIR
    };

    const batchStartTime = Date.now();

    // Process only the images that don't have videos yet
    for (let i = 0; i < toProcess.length; i++) {
      const result = await processImage(sogni, toProcess[i], i, toProcess.length, settings);
      results.push({
        file: path.basename(toProcess[i]),
        ...result
      });
    }

    // Add skipped files to results for completeness
    for (const skippedFile of alreadyExists) {
      results.push({
        file: skippedFile,
        success: true,
        skipped: true,
        path: path.join(OUTPUT_DIR, `${path.basename(skippedFile, path.extname(skippedFile))}.mp4`),
        time: 0
      });
    }

    // Display summary
    console.log();
    console.log('═'.repeat(60));
    console.log('📊 BATCH PROCESSING COMPLETE');
    console.log('═'.repeat(60));
    console.log();

    const successful = results.filter(r => r.success && !r.skipped);
    const skipped = results.filter(r => r.success && r.skipped);
    const failed = results.filter(r => !r.success);

    console.log(`✅ Successful: ${successful.length}/${imageFiles.length}`);
    console.log(`⏭️  Skipped (already exists): ${skipped.length}/${imageFiles.length}`);
    console.log(`❌ Failed: ${failed.length}/${imageFiles.length}`);
    console.log();

    if (successful.length > 0) {
      console.log('Newly generated videos:');
      successful.forEach(r => {
        console.log(`  ✓ ${r.file} → ${r.path} (${formatDuration(r.time)})`);
      });
    }

    if (skipped.length > 0) {
      console.log(`\n⏭️  ${skipped.length} file(s) were skipped (videos already exist)`);
    }

    if (failed.length > 0) {
      console.log('\nFailed videos:');
      failed.forEach(r => {
        console.log(`  ✗ ${r.file}: ${r.error}`);
      });
    }

    const totalElapsed = (Date.now() - batchStartTime) / 1000;
    console.log();
    log('⏱️', `Total batch time: ${formatDuration(totalElapsed)}`);

    if (successful.length > 0) {
      const avgTime = successful.reduce((acc, r) => acc + r.time, 0) / successful.length;
      log('📈', `Average time per newly generated video: ${formatDuration(avgTime)}`);
    }

    // Cleanup
    await sogni.account.logout();
    log('👋', 'Logged out successfully');

  } catch (error) {
    console.error();
    log('❌', `Error: ${error.message}`);
    process.exit(1);
  } finally {
    // Ensure logout
    try {
      await sogni.account.logout();
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