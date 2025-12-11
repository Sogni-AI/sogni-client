#!/usr/bin/env node
/**
 * Image-to-Video Example with Balance & Cost Confirmation
 *
 * This script generates a video from an input image using the Sogni Client SDK.
 * It displays your account balance and requires confirmation before spending tokens.
 *
 * Prerequisites:
 * - Set SOGNI_USERNAME and SOGNI_PASSWORD in .env file (or will prompt)
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
    image: null,
    width: null, // Will auto-detect if not specified
    height: null, // Will auto-detect if not specified
    fps: 16,
    frames: 81,
    model: null, // Will prompt for speed/quality if not specified
    modelExplicit: false,
    steps: null, // Will default based on model variant
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
  --steps <n>    Inference steps (Speed: 4-8, default 4; Quality: 20-40, default 25)
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
  node video_image_to_video.mjs --image photo.jpg --fps 32 --frames 161 --steps 6
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
    } else if (arg === '--steps' && args[i + 1]) {
      options.steps = parseInt(args[++i], 10);
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
 * Interactively pick an image file from test-assets directory
 */
async function pickImageFile(defaultImage) {
  // If image was provided via CLI, use it
  if (defaultImage && fs.existsSync(defaultImage)) {
    return defaultImage;
  }

  // Check test-assets directory first
  const scanDir = './test-assets';
  if (fs.existsSync(`${scanDir}/placeholder.jpg`)) {
    log('🖼️', 'Found placeholder.jpg in test-assets, using as source image');
    return `${scanDir}/placeholder.jpg`;
  }

  // If input.png exists in current directory, use it
  if (fs.existsSync('input.png')) {
    log('🖼️', 'Found input.png, using as source image');
    return 'input.png';
  }

  // If not TTY, error out
  if (!process.stdin.isTTY) {
    throw new Error(
      'No input image specified. Use --image <path> or place an image in test-assets directory.'
    );
  }

  // List available image files from test-assets directory (if it exists)
  let imageFiles = [];
  let selectedDir = '.';

  if (fs.existsSync(scanDir)) {
    imageFiles = fs
      .readdirSync(scanDir)
      .filter((f) => /\.(jpg|jpeg|png|webp)$/i.test(f))
      .sort();
    selectedDir = scanDir;
  }

  // If no files in test-assets, check current directory
  if (imageFiles.length === 0) {
    imageFiles = fs
      .readdirSync('.')
      .filter((f) => /\.(jpg|jpeg|png|webp)$/i.test(f))
      .sort();
    selectedDir = '.';
  }

  if (imageFiles.length === 0) {
    throw new Error(
      'No image files found. Use --image <path> to specify an image.'
    );
  }

  console.log(`\n🖼️  Select an image file from ${selectedDir}:\n`);
  imageFiles.forEach((file, i) => {
    console.log(`  ${i + 1}. ${file}`);
  });
  console.log();

  const answer = await askQuestion(`Enter choice [1-${imageFiles.length}]: `);
  const choice = parseInt(answer, 10);

  if (isNaN(choice) || choice < 1 || choice > imageFiles.length) {
    throw new Error('Invalid choice');
  }

  const selectedFile = selectedDir === '.' ? imageFiles[choice - 1] : `${selectedDir}/${imageFiles[choice - 1]}`;
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
async function getVideoJobEstimate(tokenType, modelId, width, height, frames, fps, steps) {
  const url = `https://socket.sogni.ai/api/v1/job-video/estimate/${tokenType}/${encodeURIComponent(modelId)}/${width}/${height}/${frames}/${fps}/${steps}`;
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
  console.log('║        Sogni Image-to-Video (via Wan 2.2 14B)            ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log();

  // Load credentials from .env or prompt user
  const { username: USERNAME, password: PASSWORD } = await loadCredentials();

  // Prompt for model if not specified
  if (!VIDEO_MODEL_ID) {
    VIDEO_MODEL_ID = await askSpeedOrQuality();
  }

  // Determine if using speed (LoRA) variant
  const isSpeedVariant = VIDEO_MODEL_ID.includes('lightx2v');

  // Set and validate steps based on model variant
  let steps = OPTIONS.steps;
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

  // Pick image file
  const imagePath = await pickImageFile(INPUT_IMAGE);
  const resolvedImagePath = path.resolve(imagePath);

  if (!fs.existsSync(resolvedImagePath)) {
    throw new Error(`Image file not found: ${resolvedImagePath}`);
  }

  log('🖼️', `Input image: ${resolvedImagePath}`);
  console.log();

  // Ask for prompt if not provided via CLI
  let finalPrompt = POSITIVE_PROMPT;
  if (!finalPrompt && process.stdin.isTTY) {
    console.log('📝 Enter a text prompt to guide the animation (optional):');
    console.log('   (Press Enter to skip for pure image animation)');
    console.log();
    finalPrompt = await askQuestion('Prompt: ');
    console.log();
  }

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

  // Initialize client
  const APP_ID = `${USERNAME || 'user'}-i2v-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  console.log(`\n🔎 Using appId: ${APP_ID}\n`);

  // Load optional configuration from environment
  const testnet = process.env.SOGNI_TESTNET === 'true';
  const socketEndpoint = process.env.SOGNI_SOCKET_ENDPOINT;
  const restEndpoint = process.env.SOGNI_REST_ENDPOINT;

  // Only disable SSL verification if testnet is enabled
  if (testnet) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  }

  const clientConfig = {
    appId: APP_ID,
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
      VIDEO_CONFIG.fps,
      steps
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
      `│ ${'Steps:'.padEnd(labelWidth)}${String(steps).padEnd(boxWidth - labelWidth - 2)} │`
    );
    console.log(
      `│ ${'Seed:'.padEnd(labelWidth)}${String(SEED).padEnd(boxWidth - labelWidth - 2)} │`
    );
    
    // Add prompt inside the box
    const promptText = finalPrompt || '(no prompt)';
    const promptLabel = 'Prompt:';
    if (promptText.length + labelWidth + 2 <= boxWidth - 2) {
      // Short prompt - fits on one line
      console.log(
        `│ ${promptLabel.padEnd(labelWidth)}${promptText.padEnd(boxWidth - labelWidth - 2)} │`
      );
    } else {
      // Long prompt - wrap it
      console.log(`│ ${promptLabel.padEnd(boxWidth - 2)} │`);
      const maxPromptWidth = boxWidth - 4; // Leave 2 chars padding on each side
      let remainingText = promptText;
      while (remainingText.length > 0) {
        const line = remainingText.substring(0, maxPromptWidth);
        console.log(`│  ${line.padEnd(boxWidth - 4)}  │`);
        remainingText = remainingText.substring(maxPromptWidth);
      }
    }
    
    console.log('└─────────────────────────────────────────────────────────┘');
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

    // Read image buffer
    const imageBuffer = fs.readFileSync(resolvedImagePath);

    // Create project
    log('📤', 'Submitting video generation job...');
    log('⏳', '(This may take several minutes)');
    console.log();

    let startTime = null;
    project = await sogni.projects.create({
      type: 'video',
      modelId: VIDEO_MODEL_ID,
      positivePrompt: finalPrompt || '',
      negativePrompt: '',
      stylePrompt: '',
      numberOfMedia: 1,
      steps: steps,
      seed: SEED,
      width: WIDTH,
      height: HEIGHT,
      referenceImage: imageBuffer, // Pass the image buffer directly
      frames: VIDEO_CONFIG.frames,
      fps: VIDEO_CONFIG.fps,
      tokenType: tokenType
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
          log('🚀', `Job started on worker: ${event.workerName || 'Unknown'}`);
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

    if (startTime) {
      const elapsed = (Date.now() - startTime) / 1000;
      log('⏱️', `Total time: ${formatDuration(elapsed)}`);
    }

    // Open the video
    log('🎬', 'Opening video...');
    openFile(savePath);

    // Cleanup
    await sogni.account.logout();
  } catch (error) {
    console.error();
    log('❌', `Error: ${error.message}`);
    process.exit(1);
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
    } catch {
      // Ignore logout errors (including websocket disconnect messages)
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
