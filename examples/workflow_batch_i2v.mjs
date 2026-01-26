#!/usr/bin/env node
/**
 * Batch Image-to-Video Workflow
 *
 * This script processes all images in a specified folder and generates videos
 * using the same settings for all files. It prompts once for settings and applies
 * them to all images sequentially.
 *
 * Prerequisites:
 * - Set SOGNI_USERNAME and SOGNI_PASSWORD in .env file (or will prompt)
 * - Place images in the input folder (default: ./toprocess)
 * - You need access to the 'fast' network for video generation
 *
 * Usage:
 *   node workflow_batch_i2v.mjs                              # Interactive mode
 *   node workflow_batch_i2v.mjs "camera pans left"           # With prompt
 *   node workflow_batch_i2v.mjs "zoom in" --folder ./images  # Custom folder
 *   node workflow_batch_i2v.mjs --fps 32 --duration 5        # With options
 *
 * Options:
 *   --folder      Input folder containing images (default: ./toprocess)
 *   --model       Model: lightx2v or quality (default: prompts for selection)
 *   --width       Video width (default: auto from first image, min: 480)
 *   --height      Video height (default: auto from first image, min: 480)
 *   --duration    Duration in seconds (default: 5, converts to frames)
 *   --fps         Frames per second: 16, 24, 30, or 32 (default: model-specific, 24 for LTX-2)
 *   --seed        Random seed for all videos, or -1 for random each (default: -1)
 *   --guidance    Guidance scale (default: model-specific)
 *   --shift       Motion intensity 1.0-8.0 (default: model-specific)
 *   --comfy-sampler  ComfyUI sampler name (default: euler)
 *   --comfy-scheduler ComfyUI scheduler name (default: simple)
 *   --negative    Negative prompt (default: none)
 *   --output      Output directory (default: ./output)
 *   --skip-existing  Skip images that already have output videos (default: true)
 *   --no-interactive  Skip interactive prompts
 *   --help        Show this help message
 */

import { SogniClient } from '../dist/index.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pipeline } from 'node:stream';
import { promisify } from 'node:util';
import { exec } from 'node:child_process';
import {
  loadCredentials,
  loadTokenTypePreference,
  saveTokenTypePreference
} from './credentials.mjs';
import {
  MODELS,
  VIDEO_CONSTRAINTS,
  askQuestion,
  selectModel,
  promptCoreOptions,
  promptVideoDuration,
  promptAdvancedOptions,
  processImageForVideo,
  log,
  formatDuration,
  displayConfig,
  getUniqueFilename,
  generateVideoFilename,
  generateRandomSeed
} from './workflow-helpers.mjs';

const streamPipeline = promisify(pipeline);

// Default prompt for this workflow
const DEFAULT_PROMPT =
  'A cinematic camera movement that brings the image to life with smooth, natural motion';

// ============================================
// Parse Command Line Arguments
// ============================================

async function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    prompt: null,
    negative: null,
    folder: './toprocess',
    modelKey: null,
    width: null,
    height: null,
    duration: null,
    fps: null,
    frames: null,
    seed: null,
    guidance: null,
    shift: null,
    sampler: null,
    scheduler: null,
    output: './output',
    skipExisting: true,
    interactive: true
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      showHelp();
      process.exit(0);
    } else if (arg === '--no-interactive') {
      options.interactive = false;
    } else if (arg === '--folder' && args[i + 1]) {
      options.folder = args[++i];
    } else if (arg === '--model' && args[i + 1]) {
      options.modelKey = args[++i];
    } else if (arg === '--width' && args[i + 1]) {
      options.width = parseInt(args[++i], 10);
    } else if (arg === '--height' && args[i + 1]) {
      options.height = parseInt(args[++i], 10);
    } else if (arg === '--duration' && args[i + 1]) {
      options.duration = parseFloat(args[++i]);
    } else if (arg === '--fps' && args[i + 1]) {
      options.fps = parseInt(args[++i], 10);
    } else if (arg === '--frames' && args[i + 1]) {
      options.frames = parseInt(args[++i], 10);
    } else if (arg === '--negative' && args[i + 1]) {
      options.negative = args[++i];
    } else if (arg === '--seed' && args[i + 1]) {
      options.seed = parseInt(args[++i], 10);
    } else if (arg === '--guidance' && args[i + 1]) {
      options.guidance = parseFloat(args[++i]);
    } else if (arg === '--shift' && args[i + 1]) {
      options.shift = parseFloat(args[++i]);
    } else if (arg === '--comfy-sampler' && args[i + 1]) {
      options.sampler = args[++i];
    } else if (arg === '--comfy-scheduler' && args[i + 1]) {
      options.scheduler = args[++i];
    } else if (arg === '--output' && args[i + 1]) {
      options.output = args[++i];
    } else if (arg === '--skip-existing') {
      options.skipExisting = true;
    } else if (arg === '--no-skip-existing') {
      options.skipExisting = false;
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
Batch Image-to-Video Workflow

Usage:
  node workflow_batch_i2v.mjs                              # Interactive mode
  node workflow_batch_i2v.mjs "camera pans left"           # With prompt
  node workflow_batch_i2v.mjs "zoom in" --folder ./images  # Custom folder

Available Models:
  lightx2v - WAN 2.2 14B I2V LightX2V (fast, 4-step, default)
  quality  - WAN 2.2 14B I2V (high quality, 20-step)

Options:
  --folder      Input folder containing images (default: ./toprocess)
  --model       Model: lightx2v or quality (default: prompts for selection)
  --negative    Negative prompt (default: none)
  --width       Video width (default: auto from first image, min: 480)
  --height      Video height (default: auto from first image, min: 480)
  --duration    Duration in seconds (default: 5)
  --fps         Frames per second: 16, 24, 30, or 32 (default: model-specific)
  --seed        Random seed for all, or -1 for random each (default: -1)
  --guidance    Guidance scale (default: model-specific)
  --shift       Motion intensity 1.0-8.0 (default: model-specific)
  --comfy-sampler  ComfyUI sampler name (default: euler)
  --comfy-scheduler ComfyUI scheduler name (default: simple)
  --output      Output directory (default: ./output)
  --skip-existing  Skip images that already have output videos (default)
  --no-skip-existing  Re-process all images
  --no-interactive  Skip interactive prompts
  --help        Show this help message

Directory Structure:
  Place your input images in the folder (default: ./toprocess/)
  Output videos will be saved to the output folder (default: ./output/)
  Videos are named after their source image (e.g., photo.jpg -> photo.mp4)
`);
}

// ============================================
// Helper Functions
// ============================================

/**
 * Get all image files from a folder
 */
function getImageFiles(folderPath) {
  if (!fs.existsSync(folderPath)) {
    throw new Error(`Input folder not found: ${folderPath}`);
  }

  const files = fs
    .readdirSync(folderPath)
    .filter((f) => /\.(jpg|jpeg|png|webp)$/i.test(f))
    .sort()
    .map((f) => ({
      name: f,
      basename: path.basename(f, path.extname(f)),
      path: path.join(folderPath, f)
    }));

  return files;
}

/**
 * Check if output video already exists
 */
function videoExists(basename, outputDir) {
  const videoPath = path.join(outputDir, `${basename}.mp4`);
  return fs.existsSync(videoPath);
}

/**
 * Get video job cost estimate
 */
async function getVideoJobEstimate(tokenType, modelId, width, height, frames, fps, steps) {
  let baseUrl = process.env.SOGNI_SOCKET_ENDPOINT || 'https://socket.sogni.ai';
  if (baseUrl.startsWith('wss://')) {
    baseUrl = baseUrl.replace('wss://', 'https://');
  } else if (baseUrl.startsWith('ws://')) {
    baseUrl = baseUrl.replace('ws://', 'https://');
  }
  const url = `${baseUrl}/api/v1/job-video/estimate/${tokenType}/${encodeURIComponent(modelId)}/${width}/${height}/${frames}/${fps}/${steps}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to get cost estimate: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Download video from URL
 */
async function downloadVideo(url, outputPath) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download video: ${response.statusText}`);
  }

  const fileStream = fs.createWriteStream(outputPath);
  await streamPipeline(response.body, fileStream);
}

/**
 * Open video in default OS video player
 */
function openVideo(videoPath) {
  const { platform } = process;
  let command;

  if (platform === 'darwin') {
    command = `open "${videoPath}"`;
  } else if (platform === 'win32') {
    command = `start "" "${videoPath}"`;
  } else {
    command = `xdg-open "${videoPath}"`;
  }

  exec(command, (error) => {
    if (error) {
      // Silently ignore errors when opening videos in batch mode
    }
  });
}

// ============================================
// Main Logic
// ============================================

async function main() {
  const OPTIONS = await parseArgs();

  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║           Batch Image-to-Video Workflow                  ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log();

  // Load credentials
  const { username: USERNAME, password: PASSWORD } = await loadCredentials();

  // Find images in the input folder
  let imageFiles;
  try {
    imageFiles = getImageFiles(OPTIONS.folder);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    console.error(`\nPlease create the folder and add images: mkdir -p ${OPTIONS.folder}`);
    process.exit(1);
  }

  if (imageFiles.length === 0) {
    console.error(`Error: No image files found in ${OPTIONS.folder}`);
    console.error('\nSupported formats: .jpg, .jpeg, .png, .webp');
    process.exit(1);
  }

  // Filter out images that already have output videos if skipExisting is true
  let filesToProcess = imageFiles;
  if (OPTIONS.skipExisting) {
    filesToProcess = imageFiles.filter((f) => !videoExists(f.basename, OPTIONS.output));
    const skipped = imageFiles.length - filesToProcess.length;
    if (skipped > 0) {
      log('⏭️', `Skipping ${skipped} image(s) with existing output videos`);
    }
  }

  if (filesToProcess.length === 0) {
    console.log('✅ All images already processed!');
    console.log(`   Output folder: ${OPTIONS.output}`);
    process.exit(0);
  }

  log('📂', `Found ${filesToProcess.length} image(s) to process in ${OPTIONS.folder}`);
  console.log();

  // Get dimensions from first image for defaults
  let initialDimensions = { width: 832, height: 480 };
  try {
    const imageSize = (await import('image-size')).default;
    const dims = imageSize(filesToProcess[0].path);
    if (dims.width && dims.height) {
      initialDimensions = { width: dims.width, height: dims.height };
      log('📐', `First image dimensions: ${dims.width}x${dims.height}`);
    }
  } catch (error) {
    log('⚠️', 'Could not read first image dimensions, using defaults');
  }

  // Interactive mode: select model and options
  let modelConfig;
  if (OPTIONS.interactive && !OPTIONS.modelKey) {
    const selection = await selectModel(MODELS.i2v, 'lightx2v');
    OPTIONS.modelKey = selection.key;
    modelConfig = selection.config;
  } else {
    OPTIONS.modelKey = OPTIONS.modelKey || 'lightx2v';
    modelConfig = MODELS.i2v[OPTIONS.modelKey];
    if (!modelConfig) {
      console.error(`Error: Unknown model '${OPTIONS.modelKey}'. Use 'lightx2v' or 'quality'.`);
      process.exit(1);
    }
  }

  log('🎬', `Selected model: ${modelConfig.name}`);

  // Set default dimensions
  modelConfig.defaultWidth = initialDimensions.width;
  modelConfig.defaultHeight = initialDimensions.height;

  // Interactive mode: prompt for options
  if (OPTIONS.interactive) {
    await promptCoreOptions(OPTIONS, modelConfig, {
      defaultPrompt: DEFAULT_PROMPT,
      isVideo: true
    });

    // Video-specific: duration
    await promptVideoDuration(OPTIONS, modelConfig);

    // Ask about advanced options
    const advancedChoice = await askQuestion('\nCustomize advanced options? [y/N]: ');
    if (advancedChoice.toLowerCase() === 'y' || advancedChoice.toLowerCase() === 'yes') {
      await promptAdvancedOptions(OPTIONS, modelConfig, { isVideo: true });
    }

    console.log('\n✅ Configuration complete!\n');
  }

  // Apply defaults
  if (!OPTIONS.prompt) OPTIONS.prompt = DEFAULT_PROMPT;
  if (!OPTIONS.fps) OPTIONS.fps = modelConfig.defaultFps || VIDEO_CONSTRAINTS.fps.default;
  if (!OPTIONS.shift) OPTIONS.shift = modelConfig.defaultShift;
  if (!OPTIONS.sampler) OPTIONS.sampler = modelConfig.defaultComfySampler || 'euler';
  if (!OPTIONS.scheduler) OPTIONS.scheduler = modelConfig.defaultComfyScheduler || 'simple';
  if (OPTIONS.guidance === undefined || OPTIONS.guidance === null) {
    OPTIONS.guidance = modelConfig.defaultGuidance;
  }

  // Use model-specific frame limits
  const maxFrames = modelConfig.maxFrames || VIDEO_CONSTRAINTS.frames.max;

  // Calculate frames from duration if not explicitly set
  if (!OPTIONS.frames) {
    const duration = OPTIONS.duration || 5;
    OPTIONS.frames = Math.round(duration * OPTIONS.fps) + 1;
    OPTIONS.frames = Math.max(VIDEO_CONSTRAINTS.frames.min, Math.min(maxFrames, OPTIONS.frames));
  }

  // Validate FPS - use model-specific allowed values or global defaults
  const allowedFps = modelConfig.allowedFps || VIDEO_CONSTRAINTS.fps.allowedValues;
  if (!allowedFps.includes(OPTIONS.fps)) {
    console.error(`Error: FPS must be one of: ${allowedFps.join(', ')}`);
    process.exit(1);
  }

  // Validate frames
  if (OPTIONS.frames < VIDEO_CONSTRAINTS.frames.min || OPTIONS.frames > maxFrames) {
    console.error(`Error: Frames must be between ${VIDEO_CONSTRAINTS.frames.min} and ${maxFrames}`);
    process.exit(1);
  }

  // Create output directory
  if (!fs.existsSync(OPTIONS.output)) {
    fs.mkdirSync(OPTIONS.output, { recursive: true });
  }

  // Initialize client
  const clientConfig = {
    appId: `sogni-workflow-batch-i2v-${Date.now()}`,
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
      }
    } else {
      console.log(
        `💳 Using saved payment preference: ${tokenType.charAt(0).toUpperCase() + tokenType.slice(1)} tokens`
      );
      console.log();
    }

    // Show batch configuration
    const videoDuration = (OPTIONS.frames - 1) / OPTIONS.fps;
    displayConfig('Batch Processing Configuration', {
      Model: modelConfig.name,
      Prompt: OPTIONS.prompt,
      'Input Folder': OPTIONS.folder,
      'Images to Process': filesToProcess.length,
      'Output Folder': OPTIONS.output,
      Resolution: `${OPTIONS.width || 'auto'}x${OPTIONS.height || 'auto'}`,
      Duration: `${videoDuration.toFixed(1)}s`,
      FPS: OPTIONS.fps,
      Frames: OPTIONS.frames,
      Guidance: OPTIONS.guidance,
      Shift: OPTIONS.shift,
      Seed: OPTIONS.seed !== null ? OPTIONS.seed : 'random each'
    });

    if (OPTIONS.negative) {
      console.log(`   Negative prompt: ${OPTIONS.negative}`);
    }

    // Get cost estimate for one video
    log('💵', 'Fetching cost estimate...');
    const estimate = await getVideoJobEstimate(
      tokenType,
      modelConfig.id,
      OPTIONS.width || initialDimensions.width,
      OPTIONS.height || initialDimensions.height,
      OPTIONS.frames,
      OPTIONS.fps,
      modelConfig.defaultSteps
    );

    console.log();
    console.log('📊 Cost Estimate (per video):');

    let costPerVideo;
    if (tokenType === 'spark') {
      costPerVideo = parseFloat(estimate.quote.project.costInSpark || 0);
      const totalCost = costPerVideo * filesToProcess.length;
      const currentBalance = parseFloat(balance.spark.net || 0);
      console.log(`   Per video: ${costPerVideo.toFixed(2)} Spark`);
      console.log(`   Total (${filesToProcess.length} videos): ${totalCost.toFixed(2)} Spark`);
      console.log(`   Balance: ${currentBalance.toFixed(2)} → ${(currentBalance - totalCost).toFixed(2)} Spark`);
      console.log(`   USD: ~$${(totalCost * 0.005).toFixed(2)}`);

      if (currentBalance < totalCost) {
        console.log();
        log('⚠️', `Warning: Insufficient balance for all ${filesToProcess.length} videos`);
        const affordableCount = Math.floor(currentBalance / costPerVideo);
        log('⚠️', `You can afford approximately ${affordableCount} videos`);
      }
    } else {
      costPerVideo = parseFloat(estimate.quote.project.costInSogni || 0);
      const totalCost = costPerVideo * filesToProcess.length;
      const currentBalance = parseFloat(balance.sogni.net || 0);
      console.log(`   Per video: ${costPerVideo.toFixed(2)} Sogni`);
      console.log(`   Total (${filesToProcess.length} videos): ${totalCost.toFixed(2)} Sogni`);
      console.log(`   Balance: ${currentBalance.toFixed(2)} → ${(currentBalance - totalCost).toFixed(2)} Sogni`);
      console.log(`   USD: ~$${(totalCost * 0.05).toFixed(2)}`);

      if (currentBalance < totalCost) {
        console.log();
        log('⚠️', `Warning: Insufficient balance for all ${filesToProcess.length} videos`);
        const affordableCount = Math.floor(currentBalance / costPerVideo);
        log('⚠️', `You can afford approximately ${affordableCount} videos`);
      }
    }

    console.log();
    if (OPTIONS.interactive) {
      const proceed = await askQuestion('Proceed with batch generation? [Y/n]: ');
      if (proceed.toLowerCase() === 'n' || proceed.toLowerCase() === 'no') {
        log('❌', 'Batch generation cancelled');
        process.exit(0);
      }
    } else {
      console.log('✓ Proceeding with batch generation (non-interactive mode)');
    }

    // Wait for models
    log('🔄', 'Loading available models...');
    const models = await sogni.projects.waitForModels();
    const videoModel = models.find((m) => m.id === modelConfig.id);

    if (!videoModel) {
      throw new Error(`Model ${modelConfig.id} not available`);
    }

    log('✓', `Model ready: ${videoModel.name}`);
    console.log();

    // Process each image
    let successCount = 0;
    let failCount = 0;
    const totalCount = filesToProcess.length;
    const batchStartTime = Date.now();

    for (let i = 0; i < filesToProcess.length; i++) {
      const imageFile = filesToProcess[i];
      const imageStartTime = Date.now();

      console.log();
      console.log('━'.repeat(60));
      console.log(`📸 Processing image ${i + 1}/${totalCount}: ${imageFile.name}`);
      console.log('━'.repeat(60));
      console.log();

      try {
        // Process the image with memory budget constraints
        const processedImage = await processImageForVideo(imageFile.path, OPTIONS.frames, {
          targetWidth: OPTIONS.width,
          targetHeight: OPTIONS.height
        });

        log('📐', `Video dimensions: ${processedImage.width}x${processedImage.height}`);

        // Generate seed for this video
        const seed = OPTIONS.seed !== null && OPTIONS.seed !== -1
          ? OPTIONS.seed
          : generateRandomSeed();

        log('🎲', `Seed: ${seed}`);

        // Create the video
        const imageBlob = new Blob([processedImage.buffer]);

        const projectParams = {
          type: 'video',
          modelId: modelConfig.id,
          positivePrompt: OPTIONS.prompt,
          numberOfMedia: 1,
          width: processedImage.width,
          height: processedImage.height,
          frames: OPTIONS.frames,
          fps: OPTIONS.fps,
          shift: OPTIONS.shift,
          seed: seed,
          referenceImage: imageBlob,
          sampler: OPTIONS.sampler,
          scheduler: OPTIONS.scheduler,
          tokenType: tokenType
        };

        if (OPTIONS.guidance !== undefined && OPTIONS.guidance !== null) {
          projectParams.guidance = OPTIONS.guidance;
        }

        if (OPTIONS.negative) {
          projectParams.negativePrompt = OPTIONS.negative;
        }

        log('📤', 'Submitting video generation job...');
        const project = await sogni.projects.create(projectParams);

        // Wait for completion with progress updates
        let progressInterval;

        // Set up progress tracking
        project._lastETA = undefined;
        project._lastStep = undefined;
        project._lastStepCount = undefined;

        const jobHandler = (event) => {
          if (event.projectId !== project.id) return;

          switch (event.type) {
            case 'started':
              progressInterval = setInterval(() => {
                const elapsed = (Date.now() - imageStartTime) / 1000;
                let progressStr = `\r  Generating...`;
                if (project._lastStep !== undefined && project._lastStepCount !== undefined) {
                  const stepPercent = Math.round((project._lastStep / project._lastStepCount) * 100);
                  progressStr += ` Step ${project._lastStep}/${project._lastStepCount} (${stepPercent}%)`;
                }
                if (project._lastETA !== undefined) {
                  const elapsedSinceUpdate = (Date.now() - project._lastETAUpdate) / 1000;
                  const adjustedETA = Math.max(1, project._lastETA - elapsedSinceUpdate);
                  progressStr += ` ETA: ${formatDuration(adjustedETA)}`;
                }
                progressStr += ` (${formatDuration(elapsed)} elapsed)   `;
                process.stdout.write(progressStr);
              }, 1000);
              log('🚀', `Job started on worker: ${event.workerName || 'Unknown'}`);
              break;

            case 'jobETA':
              project._lastETA = event.etaSeconds;
              project._lastETAUpdate = Date.now();
              break;

            case 'progress':
              if (event.step !== undefined && event.stepCount !== undefined) {
                project._lastStep = event.step;
                project._lastStepCount = event.stepCount;
              }
              break;
          }
        };

        sogni.projects.on('job', jobHandler);

        // Wait for project completion
        await project.waitForCompletion();

        // Clean up progress interval
        if (progressInterval) {
          clearInterval(progressInterval);
          process.stdout.write('\r' + ' '.repeat(70) + '\r');
        }

        sogni.projects.off('job', jobHandler);

        // Check result
        const jobs = project.jobs;
        if (jobs.length > 0 && jobs[0].resultUrl) {
          // Calculate generation time and generate output filename
          const elapsedSeconds = (Date.now() - imageStartTime) / 1000;
          const desiredPath = generateVideoFilename({
            modelId: modelConfig.id,
            frames: OPTIONS.frames,
            fps: OPTIONS.fps,
            width: processedImage.width,
            height: processedImage.height,
            seed: seed,
            prompt: OPTIONS.prompt,
            generationTime: elapsedSeconds,
            outputDir: OPTIONS.output
          });
          const outputPath = getUniqueFilename(desiredPath);

          log('⬇️', 'Downloading video...');
          await downloadVideo(jobs[0].resultUrl, outputPath);
          log('✅', `Completed: ${outputPath} (${elapsedSeconds.toFixed(1)}s)`);
          successCount++;
        } else {
          const error = jobs[0]?.error || 'No result URL';
          throw new Error(`Job failed: ${error}`);
        }
      } catch (error) {
        log('❌', `Failed: ${imageFile.name} - ${error.message}`);
        failCount++;
      }
    }

    // Summary
    console.log();
    console.log('═'.repeat(60));
    console.log('                    BATCH COMPLETE');
    console.log('═'.repeat(60));
    console.log();

    const totalTime = ((Date.now() - batchStartTime) / 1000 / 60).toFixed(1);
    console.log(`   Total time: ${totalTime} minutes`);
    console.log(`   Successful: ${successCount}/${totalCount}`);
    if (failCount > 0) {
      console.log(`   Failed: ${failCount}/${totalCount}`);
    }
    console.log(`   Output: ${OPTIONS.output}`);
    console.log();

    if (failCount === 0) {
      log('🎉', 'All videos generated successfully!');
    } else if (successCount > 0) {
      log('⚠️', `${successCount} videos generated, ${failCount} failed`);
    } else {
      log('❌', 'All videos failed to generate');
      process.exit(1);
    }
  } catch (error) {
    log('❌', `Error: ${error.message}`);
    process.exit(1);
  } finally {
    try {
      await sogni.account.logout();
    } catch {
      // Ignore logout errors
    }
  }
}

// ============================================
// Run Main
// ============================================

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

