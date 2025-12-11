/**
 * Animate-Move Example using WAN 2.2
 *
 * This example demonstrates how to transfer motion from a reference video
 * to a subject in a reference image using the animate-move workflow.
 *
 * Prerequisites:
 * - You need a Sogni account with access to the fast supernet
 * - Video generation requires the 'fast' network (not 'relaxed')
 * - Set SOGNI_USERNAME and SOGNI_PASSWORD in .env file (or will prompt)
 *
 * Usage:
 *   node video_animate_move.mjs
 *   node video_animate_move.mjs --model wan_v2.2-14b-fp8_animate-move_lightx2v
 *   node video_animate_move.mjs --steps 6
 *   node video_animate_move.mjs --width 640 --height 480
 *
 * Options:
 *   --model <id>   Model ID (prompts for speed/quality if not specified)
 *   --steps <n>    Inference steps (Speed: 4-8, default 4; Quality: 20-40, default 25)
 *   --width <n>    Video width (default: auto-detect from reference video)
 *   --height <n>   Video height (default: auto-detect from reference video)
 */

import * as fs from 'node:fs';
import { pipeline } from 'node:stream';
import { promisify } from 'node:util';
import { exec } from 'node:child_process';
import * as readline from 'node:readline';
import imageSize from 'image-size';
// When running from the repo, import from local dist
// When published to npm, users would import from '@sogni-ai/sogni-client'
import { SogniClient } from '../dist/index.js';
import { loadCredentials, loadTokenTypePreference, saveTokenTypePreference } from './credentials.mjs';

// ============================================
// Configuration
// ============================================

// Model variants
const MODELS = {
  'animate-move': {
    speed: 'wan_v2.2-14b-fp8_animate-move_lightx2v',
    quality: 'wan_v2.2-14b-fp8_animate-move'
  }
};

// Parse command line args
const args = process.argv.slice(2);
const modelArg = args.find((arg, i) => arg === '--model' && args[i + 1]);
const MODEL_EXPLICIT = !!modelArg;
let VIDEO_MODEL_ID = modelArg ? args[args.indexOf(modelArg) + 1] : null;
const stepsArg = args.find((arg, i) => arg === '--steps' && args[i + 1]);
let STEPS_EXPLICIT = stepsArg ? parseInt(args[args.indexOf(stepsArg) + 1], 10) : null;
const widthArg = args.find((arg, i) => arg === '--width' && args[i + 1]);
let WIDTH = widthArg ? parseInt(args[args.indexOf(widthArg) + 1], 10) : null;
const heightArg = args.find((arg, i) => arg === '--height' && args[i + 1]);
let HEIGHT = heightArg ? parseInt(args[args.indexOf(heightArg) + 1], 10) : null;

// Reference assets for animate-move workflow
const REFERENCE_IMAGE = './test-assets/placeholder.jpg'; // Subject to animate
const REFERENCE_VIDEO = './test-assets/placeholder.mp4'; // Motion source

const VIDEO_CONFIG = {
  frames: 81,
  fps: 16
};

const OUTPUT_DIR = './videos';
const streamPipeline = promisify(pipeline);

// ============================================
// Helper Functions
// ============================================

function ensureOutputDir() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
}

async function downloadFile(url, filename, label = 'file') {
  ensureOutputDir();
  const savePath = `${OUTPUT_DIR}/${filename}`;
  console.log(`Downloading ${label}: ${filename}`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${label}: ${response.statusText}`);
  }
  await streamPipeline(response.body, fs.createWriteStream(savePath));
  return savePath;
}

async function downloadVideo(url, projectId, index) {
  const filename = `video_animate-move_${projectId}_${index}.mp4`;
  return downloadFile(url, filename, 'video');
}

function formatDuration(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function log(emoji, message) {
  console.log(`${emoji} ${message}`);
}

/**
 * Get image dimensions using image-size library
 */
function getImageDimensions(imagePath) {
  try {
    const dimensions = imageSize(imagePath);
    if (dimensions.width && dimensions.height) {
      return { width: dimensions.width, height: dimensions.height };
    }
    return null;
  } catch (error) {
    console.warn(`⚠️  Could not extract image dimensions: ${error.message}`);
    return null;
  }
}

/**
 * Open a file with the default system application
 */
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
 * Interactively pick an image file from test-assets directory
 */
async function pickImageFile(defaultImage, label = 'reference image') {
  // If image was provided and exists, use it
  if (defaultImage && fs.existsSync(defaultImage)) {
    return defaultImage;
  }

  // If not TTY, error out
  if (!process.stdin.isTTY) {
    throw new Error(
      `No ${label} found at ${defaultImage}. Please ensure the file exists.`
    );
  }

  // List available image files from test-assets directory
  const scanDir = './test-assets';
  if (!fs.existsSync(scanDir)) {
    throw new Error(
      `Directory ${scanDir} not found. Please ensure test-assets directory exists.`
    );
  }

  const imageFiles = fs
    .readdirSync(scanDir)
    .filter((f) => /\.(jpg|jpeg|png|webp)$/i.test(f))
    .sort();

  if (imageFiles.length === 0) {
    throw new Error(
      `No image files found in ${scanDir}. Please place an image file in the test-assets directory.`
    );
  }

  console.log(`\n🖼️  Select a ${label} from ${scanDir}:\n`);
  imageFiles.forEach((file, i) => {
    console.log(`  ${i + 1}. ${file}`);
  });
  console.log();

  const answer = await askQuestion(`Enter choice [1-${imageFiles.length}]: `);
  const choice = parseInt(answer, 10);

  if (isNaN(choice) || choice < 1 || choice > imageFiles.length) {
    throw new Error('Invalid choice');
  }

  const selectedFile = `${scanDir}/${imageFiles[choice - 1]}`;
  console.log(`  → Using ${selectedFile}\n`);
  return selectedFile;
}

/**
 * Interactively pick a video file from test-assets directory
 */
async function pickVideoFile(defaultVideo, label = 'reference video') {
  // If video was provided and exists, use it
  if (defaultVideo && fs.existsSync(defaultVideo)) {
    return defaultVideo;
  }

  // If not TTY, error out
  if (!process.stdin.isTTY) {
    throw new Error(
      `No ${label} found at ${defaultVideo}. Please ensure the file exists.`
    );
  }

  // List available video files from test-assets directory
  const scanDir = './test-assets';
  if (!fs.existsSync(scanDir)) {
    throw new Error(
      `Directory ${scanDir} not found. Please ensure test-assets directory exists.`
    );
  }

  const videoFiles = fs
    .readdirSync(scanDir)
    .filter((f) => /\.(mp4|mov|avi|webm|mkv)$/i.test(f))
    .sort();

  if (videoFiles.length === 0) {
    throw new Error(
      `No video files found in ${scanDir}. Please place a video file in the test-assets directory.`
    );
  }

  console.log(`\n🎥 Select a ${label} from ${scanDir}:\n`);
  videoFiles.forEach((file, i) => {
    console.log(`  ${i + 1}. ${file}`);
  });
  console.log();

  const answer = await askQuestion(`Enter choice [1-${videoFiles.length}]: `);
  const choice = parseInt(answer, 10);

  if (isNaN(choice) || choice < 1 || choice > videoFiles.length) {
    throw new Error('Invalid choice');
  }

  const selectedFile = `${scanDir}/${videoFiles[choice - 1]}`;
  console.log(`  → Using ${selectedFile}\n`);
  return selectedFile;
}

async function askSpeedOrQuality() {
  // If model was explicitly set, use it
  if (MODEL_EXPLICIT) {
    return VIDEO_MODEL_ID;
  }

  // If not TTY, default to speed
  if (!process.stdin.isTTY) {
    return MODELS['animate-move'].speed;
  }

  console.log('\n⚡ Select generation mode:\n');
  console.log('  1. Speed   - Faster generation, good quality (LightX2V)');
  console.log('  2. Quality - Slower generation, best quality - 2.5x cost');
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
        resolve(MODELS['animate-move'].quality);
      } else {
        console.log('  → Using Speed mode\n');
        resolve(MODELS['animate-move'].speed);
      }
    });
  });
}

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
  console.log('='.repeat(60));
  console.log('Sogni Animate-Move (via Wan 2.2 14B)');
  console.log('='.repeat(60));
  console.log();

  // Load credentials from .env or prompt user
  const { username: USERNAME, password: PASSWORD } = await loadCredentials();

  // Pick or verify reference assets
  console.log('📂 Scanning for reference assets...\n');

  const referenceImagePath = await pickImageFile(null, 'reference image (subject)');
  const referenceVideoPath = await pickVideoFile(null, 'reference video (motion source)');

  console.log(`✓ Reference image (subject): ${referenceImagePath}`);
  console.log(`✓ Reference video (motion): ${referenceVideoPath}`);
  console.log();

  // Auto-detect dimensions from reference image if not specified
  if (!WIDTH || !HEIGHT) {
    log('📐', 'Detecting image dimensions...');
    const dimensions = getImageDimensions(referenceImagePath);
    if (dimensions) {
      WIDTH = WIDTH || dimensions.width;
      HEIGHT = HEIGHT || dimensions.height;
      log('✓', `Auto-detected dimensions: ${WIDTH}x${HEIGHT}`);
    } else {
      log('⚠️', 'Could not auto-detect image dimensions, using defaults: 480x832');
      WIDTH = WIDTH || 480;
      HEIGHT = HEIGHT || 832;
    }
    console.log();
  }

  // Prompt for model if not specified
  if (!VIDEO_MODEL_ID) {
    VIDEO_MODEL_ID = await askSpeedOrQuality();
  }

  // Determine if using speed (LoRA) variant
  const isSpeedVariant = VIDEO_MODEL_ID.includes('lightx2v');

  // Set and validate steps based on model variant
  let steps = STEPS_EXPLICIT;
  if (steps === null) {
    // Apply defaults
    steps = isSpeedVariant ? 4 : 25;
  } else {
    // Validate user-provided steps
    if (isSpeedVariant) {
      if (steps < 4 || steps > 8) {
        console.error(`Error: For speed variant (LightX2V), steps must be between 4 and 8 (got ${steps})`);
        process.exit(1);
      }
    } else {
      if (steps < 20 || steps > 40) {
        console.error(`Error: For quality variant, steps must be between 20 and 40 (got ${steps})`);
        process.exit(1);
      }
    }
  }

  // Load optional configuration from environment
  const testnet = process.env.SOGNI_TESTNET === 'true';
  const socketEndpoint = process.env.SOGNI_SOCKET_ENDPOINT;
  const restEndpoint = process.env.SOGNI_REST_ENDPOINT;

  // Only disable SSL verification if testnet is enabled
  if (testnet) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  }

  const clientConfig = {
    appId: `${USERNAME}-animate-move-${Date.now()}`,
    network: 'fast'
  };

  // Only add optional configs if they're set in environment
  if (testnet) clientConfig.testnet = testnet;
  if (socketEndpoint) clientConfig.socketEndpoint = socketEndpoint;
  if (restEndpoint) clientConfig.restEndpoint = restEndpoint;

  const sogni = await SogniClient.createInstance(clientConfig);

  let projectEventHandler;
  let jobEventHandler;
  let project;

  try {
    log('🔓', 'Logging in...');
    await sogni.account.login(USERNAME, PASSWORD);
    log('✓', `Logged in as: ${USERNAME}`);
    console.log();

    // Get balance for token selection
    const balance = await sogni.account.refreshBalance();

    // Check for token type preference
    let tokenType = loadTokenTypePreference();
    
    if (!tokenType) {
      // Ask user which token type to use
      const sparkBalance = parseFloat(balance.spark.net || 0).toFixed(2);
      const sogniBalance = parseFloat(balance.sogni.net || 0).toFixed(2);
      
      console.log('💳 Select payment token type:\n');
      console.log(`  1. Spark Points (Balance: ${sparkBalance})`);
      console.log(`  2. Sogni Tokens (Balance: ${sogniBalance})`);
      console.log();
      
      const tokenChoice = await askQuestion('Enter choice [1/2] (default: 1): ');
      const choice = tokenChoice.trim() || '1';
      
      if (choice === '2' || choice.toLowerCase() === 'sogni') {
        tokenType = 'sogni';
        console.log('  → Using Sogni tokens\n');
      } else {
        tokenType = 'spark';
        console.log('  → Using Spark tokens\n');
      }

      // Ask if they want to save the preference
      const savePreference = await askQuestion('Save payment preference to .env file? [Y/n]: ');
      if (savePreference.toLowerCase() !== 'n' && savePreference.toLowerCase() !== 'no') {
        saveTokenTypePreference(tokenType);
        console.log('✓ Payment preference saved\n');
      } else {
        console.log('⚠️  Payment preference not saved. You will be asked again next time.\n');
      }
    } else {
      console.log(`💳 Using saved payment preference: ${tokenType.charAt(0).toUpperCase() + tokenType.slice(1)} tokens`);
      console.log();
    }

    // Get cost estimate
    log('💵', 'Fetching cost estimate...');
    const estimate = await getVideoJobEstimate(
      tokenType,
      VIDEO_MODEL_ID,
      WIDTH,
      HEIGHT,
      VIDEO_CONFIG.frames,
      VIDEO_CONFIG.fps
    );

    console.log();
    console.log('📊 Cost Estimate:');
    
    // Show the cost in the selected token type and USD
    if (tokenType === 'spark') {
      const cost = parseFloat(estimate.quote.project.costInSpark || 0);
      const currentBalance = parseFloat(balance.spark.net || 0);
      const remaining = currentBalance - cost;
      console.log(`   Spark: ${cost.toFixed(2)} (Balance remaining: ${remaining.toFixed(2)})`);
    } else {
      const cost = parseFloat(estimate.quote.project.costInSogni || 0);
      const currentBalance = parseFloat(balance.sogni.net || 0);
      const remaining = currentBalance - cost;
      console.log(`   Sogni: ${cost.toFixed(2)} (Balance remaining: ${remaining.toFixed(2)})`);
    }
    console.log(`   USD: $${parseFloat(estimate.quote.project.costInUSD || 0).toFixed(4)}`);
    console.log();

    // Ask for confirmation
    const proceed = await askQuestion('Proceed with generation? [Y/n]: ');
    if (proceed.toLowerCase() === 'n' || proceed.toLowerCase() === 'no') {
      log('❌', 'Job cancelled by user');
      await sogni.account.logout();
      process.exit(0);
    }

    console.log();

    console.log('Loading available models...');
    const models = await sogni.projects.waitForModels();

    const videoModel = models.find((m) => m.id === VIDEO_MODEL_ID);
    if (!videoModel) {
      const videoModels = models.filter((m) => m.media === 'video');
      log('❌', `Model ${VIDEO_MODEL_ID} not found.`);
      if (videoModels.length === 0) {
        console.log('No video models currently available on the fast network.');
      } else {
        console.log('Available video models:');
        videoModels.forEach((m) => console.log(`  - ${m.id} (${m.name})`));
      }
      await sogni.account.logout();
      process.exit(1);
    }

    log('✓', `Model ready: ${videoModel.name}`);
    console.log();

    const outputDuration = (VIDEO_CONFIG.frames - 1) / VIDEO_CONFIG.fps;
    console.log('Video Configuration:');
    console.log(`  - Model: ${videoModel.name}`);
    console.log(
      `  - Frames: ${VIDEO_CONFIG.frames} (${outputDuration}s output at ${VIDEO_CONFIG.fps}fps)`
    );
    console.log(`  - FPS: ${VIDEO_CONFIG.fps}`);
    console.log(`  - Steps: ${steps}`);
    console.log();

    log('📤', 'Submitting video generation job...');
    log('⏳', '(This may take a few minutes)');
    console.log();

    let startTime = null;

    // Load the reference assets
    const referenceImageBuffer = fs.readFileSync(referenceImagePath);
    const referenceVideoBuffer = fs.readFileSync(referenceVideoPath);

    project = await sogni.projects.create({
      ...VIDEO_CONFIG,
      type: 'video',
      modelId: VIDEO_MODEL_ID,
      steps: steps,
      positivePrompt: 'Smooth natural motion, high quality animation, realistic movement',
      negativePrompt: 'blurry, low quality, distorted, artifacts, watermark, text, jittery',
      stylePrompt: '',
      numberOfMedia: 1,
      referenceImage: referenceImageBuffer,
      referenceVideo: referenceVideoBuffer,
      tokenType: tokenType,
      width: WIDTH,
      height: HEIGHT
    });

    console.log(`Project created: ${project.id}`);
    console.log();

    let isComplete = false;

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
          if (event.error.code) {
            console.log(`   Error code: ${event.error.code}`);
          }
          if (event.error.data) {
            console.log(`   Error data:`, event.error.data);
          }
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
          // Start timing when job actually starts
          if (!startTime) {
            startTime = Date.now();
            // Show progress and update every second throughout the entire job
            const progressInterval = setInterval(() => {
              if (startTime) {
                const elapsed = (Date.now() - startTime) / 1000;
                if (project._lastETA !== undefined) {
                  // We have ETA info, show it
                  process.stdout.write(
                    `\r  Generating... ETA: ${formatDuration(project._lastETA)} (${formatDuration(elapsed)} elapsed)   `
                  );
                } else {
                  // No ETA yet, just show elapsed
                  process.stdout.write(`\r  Generating... (${formatDuration(elapsed)} elapsed)   `);
                }
              }
            }, 1000);
            // Store interval ID on the project so we can clear it later
            project._progressInterval = progressInterval;
            project._lastETA = undefined;
          }
          console.log(`\n  Job started on worker: ${event.workerName || 'Unknown'}`);
          break;
        case 'jobETA': {
          // Store the latest ETA so the interval can use it
          project._lastETA = event.etaSeconds;
          break;
        }
        case 'completed':
          // Clear the progress interval and show final message
          if (project._progressInterval) {
            clearInterval(project._progressInterval);
            project._progressInterval = null;
            // Clear the line
            process.stdout.write('\r' + ' '.repeat(70) + '\r');
          }
          log('✅', 'Job completed!');
          break;
        case 'error':
          log('❌', `Job failed: ${event.error.message}`);
          if (event.error.code) {
            console.log(`   Error code: ${event.error.code}`);
          }
          if (event.error.data) {
            console.log(`   Error data:`, event.error.data);
          }
          break;
      }
    };

    sogni.projects.on('project', projectEventHandler);
    sogni.projects.on('job', jobEventHandler);

    console.log('Generating animated video...');
    console.log('(This may take a few minutes)');
    console.log();

    try {
      const videoUrls = await project.waitForCompletion();
      isComplete = true;

      console.log('\n');
      console.log('='.repeat(60));
      console.log('Video generation complete!');
      console.log('='.repeat(60));
      
      if (startTime) {
        const totalTime = (Date.now() - startTime) / 1000;
        console.log(`Total time: ${formatDuration(totalTime)}`);
      }
      console.log();

      for (let i = 0; i < videoUrls.length; i++) {
        const path = await downloadVideo(videoUrls[i], project.id, i + 1);
        console.log(`Video saved: ${path}`);
        
        // Auto-play the first video
        if (i === 0) {
          console.log();
          log('🎬', 'Opening video...');
          openFile(path);
        }
      }

      console.log();
      console.log('Done!');
    } catch (error) {
      isComplete = true;
      console.error('\nError during video generation:', error.message);
      if (error.data) {
        console.error('Error details:', error.data);
      }
      throw error;
    } finally {
      if (projectEventHandler) {
        sogni.projects.off('project', projectEventHandler);
      }
      if (jobEventHandler) {
        sogni.projects.off('job', jobEventHandler);
      }
      // Clean up any remaining intervals
      if (project && project._progressInterval) {
        clearInterval(project._progressInterval);
      }
      try {
        await sogni.account.logout();
        console.log('Logged out.');
      } catch {
        // Ignore logout errors (including websocket disconnect messages)
      }
    }
  } catch (error) {
    console.error('Fatal error:', error.message || error);
    process.exit(1);
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
