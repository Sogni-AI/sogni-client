#!/usr/bin/env node
/**
 * Image-to-Video Workflow
 *
 * This script generates videos from input images using WAN 2.2 models.
 * Takes an image and animates it based on a text prompt.
 *
 * Prerequisites:
 * - Set SOGNI_USERNAME and SOGNI_PASSWORD in .env file (or will prompt)
 * - You need access to the 'fast' network for video generation
 *
 * Usage:
 *   node workflow_image_to_video.mjs --image input.jpg       # Interactive mode
 *   node workflow_image_to_video.mjs "zoom in" --image pic.jpg
 *   node workflow_image_to_video.mjs --image img.jpg --end-image img2.jpg  # transition
 *
 * Options:
 *   --image     Input image path (required)
 *   --end-image Optional end image for transition (i2v only)
 *   --model     Model ID (default: wan_v2.2-14b-fp8_i2v_lightx2v)
 *   --width     Video width (WAN: 480-1536 step 16, LTX-2: 384-960 step 32, output 2x)
 *   --height    Video height (WAN: 480-1536 step 16, LTX-2: 384-960 step 32, output 2x)
 *   --duration  Duration in seconds (WAN: 1-10s default 5, LTX-2: 4-10/20s default 4)
 *   --fps       Frames per second (WAN: 16/32, LTX-2: 25/50)
 *   --batch     Number of videos to generate (default: 1)
 *   --seed      Random seed for reproducibility (default: -1 for random)
 *   --guidance  Guidance scale (WAN: 0.7-8, LTX-2: 1-7)
 *   --shift     Motion intensity 1-8 (WAN models only, ignored for LTX-2)
 *   --comfy-sampler  ComfyUI sampler name (default: euler)
 *   --comfy-scheduler ComfyUI scheduler name (default: simple)
 *   --negative  Negative prompt (default: none)
 *   --style     Style prompt (default: none)
 *   --output    Output directory (default: ./output)
 *   --no-interactive  Skip interactive prompts
 *   --help      Show this help message
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
  MODELS,
  VIDEO_CONSTRAINTS,
  askQuestion,
  selectModel,
  promptCoreOptions,
  promptVideoDuration,
  promptAdvancedOptions,
  promptBatchCount,
  pickImageFile,
  readFileAsBuffer,
  processImageForVideo,
  ensureDimensionsDivisibleBy16,
  log,
  formatDuration,
  displayConfig,
  displayPrompts,
  getUniqueFilename,
  generateVideoFilename,
  generateRandomSeed
} from './workflow-helpers.mjs';

const streamPipeline = promisify(pipeline);

// Default prompt for this workflow
const DEFAULT_PROMPT =
  'A close-up shot of a young waitress in a retro 1950s diner, her warm brown eyes meeting the camera with a gentle smile. She wears a black polka-dot dress with an elegant cream lace collar, her reddish-brown hair styled in an elaborate updo with delicate curls framing her freckled face. Soft, warm light from overhead fixtures illuminates her features as she stands behind a yellow counter. The camera begins slightly to her side, then slowly pushes in toward her face, revealing the subtle rosy blush on her cheeks. In the blurred background, the soft teal walls and a glowing red "Diner" sign create a nostalgic atmosphere. The ambient sounds of clinking dishes, distant conversations, and the gentle hum of a jukebox fill the air. She tilts her head slightly and says in a friendly, warm voice: "Welcome to Rosie\'s. What can I get for you today?" The mood is inviting, timeless, and full of classic American diner charm.';

// Default image for this workflow
const DEFAULT_IMAGE = './test-assets/placeholder6.jpg';

// Video dimension constraints
const MAX_VIDEO_DIMENSION = 1536;

// ============================================
// Parse Command Line Arguments
// ============================================

async function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    prompt: null,
    negative: null,
    style: null,
    image: null,
    endImage: null,
    modelKey: null,
    width: null,
    height: null,
    duration: null,
    fps: null,
    frames: null,
    batch: 1,
    seed: null,
    guidance: null,
    shift: null,
    sampler: null,
    scheduler: null,
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
    } else if (arg === '--image' && args[i + 1]) {
      options.image = args[++i];
    } else if (arg === '--end-image' && args[i + 1]) {
      options.endImage = args[++i];
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
    } else if (arg === '--batch' && args[i + 1]) {
      options.batch = parseInt(args[++i], 10);
    } else if (arg === '--negative' && args[i + 1]) {
      options.negative = args[++i];
    } else if (arg === '--style' && args[i + 1]) {
      options.style = args[++i];
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
Image-to-Video Workflow

Usage:
  node workflow_image_to_video.mjs --image input.jpg       # Interactive mode
  node workflow_image_to_video.mjs "zoom in" --image pic.jpg
  node workflow_image_to_video.mjs --image img.jpg --end-image img2.jpg  # Interpolation

Available Models:
  wan_v2.2-14b-fp8_i2v_lightx2v  (WAN 2.2, fast 4-step, 1-10s, default)
  wan_v2.2-14b-fp8_i2v           (WAN 2.2, high quality 20-step, 1-10s)
  ltx2-19b-fp8_i2v_distilled     (LTX-2, fast 8-step, 4-20s, 2x upscaled output)
  ltx2-19b-fp8_i2v               (LTX-2, high quality 20-step, 4-10s, 2x upscaled output)

Model-Specific Constraints:
  WAN models:   480-1536px (step 16), 16/32 fps, 1-10s, shift 1-8, guidance 0.7-8
  LTX-2 models: 384-960px input (step 32), 25/50 fps, 4-10/20s, no shift, guidance 1-7
                Note: LTX-2 outputs at 2x input resolution (768x512 → 1536x1024)

Options:
  --image     Input image path (required)
  --end-image Optional end image for transition
  --model     Model ID (default: wan_v2.2-14b-fp8_i2v_lightx2v)
  --negative  Negative prompt (default: none)
  --style     Style prompt (default: none)
  --width     Video width (default: auto from image or WAN 640, LTX-2 768)
  --height    Video height (default: auto from image or WAN 640, LTX-2 512)
  --duration  Duration in seconds (default: WAN 5s, LTX-2 4s)
  --fps       Frames per second (default: WAN 16, LTX-2 25)
  --batch     Number of videos to generate (default: 1)
  --seed      Random seed (default: -1 for random)
  --guidance  Guidance scale (default: model-specific)
  --shift     Motion intensity 1-8 (WAN models only, ignored for LTX-2)
  --comfy-sampler  ComfyUI sampler (default: euler)
  --comfy-scheduler ComfyUI scheduler (default: simple)
  --output    Output directory (default: ./output)
  --no-interactive  Skip interactive prompts
  --help      Show this help message
`);
}


// ============================================
// Main Logic
// ============================================

async function main() {
  const OPTIONS = await parseArgs();

  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║              Image-to-Video Workflow                     ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log();

  // Load credentials
  const { username: USERNAME, password: PASSWORD } = await loadCredentials();

  // Interactive mode: get image path if not provided
  if (OPTIONS.interactive && !OPTIONS.image) {
    OPTIONS.image = await pickImageFile(null, 'input image');
  }

  // Validate input image
  if (!OPTIONS.image) {
    console.error('Error: Input image is required (use --image option)');
    process.exit(1);
  }
  if (!fs.existsSync(OPTIONS.image)) {
    console.error(`Error: Input image '${OPTIONS.image}' does not exist`);
    process.exit(1);
  }

  log('📷', `Input image: ${OPTIONS.image}`);

  // Get initial image dimensions for defaults (will be properly processed later with frame count)
  let initialImageDimensions = { width: 832, height: 480 };
  try {
    const imageSize = (await import('image-size')).default;
    const dims = imageSize(OPTIONS.image);
    if (dims.width && dims.height) {
      initialImageDimensions = { width: dims.width, height: dims.height };
      log('📐', `Original image dimensions: ${dims.width}x${dims.height}`);
    }
  } catch (error) {
    log('⚠️', 'Could not read image dimensions, using defaults');
  }

  // Interactive mode: select model first (before asking about end image)
  let modelConfig;
  if (OPTIONS.interactive && !OPTIONS.modelKey) {
    const selection = await selectModel(MODELS.i2v, 'wan_v2.2-14b-fp8_i2v_lightx2v');
    OPTIONS.modelKey = selection.key;
    modelConfig = selection.config;
  } else {
    OPTIONS.modelKey = OPTIONS.modelKey || 'wan_v2.2-14b-fp8_i2v_lightx2v';
    modelConfig = MODELS.i2v[OPTIONS.modelKey];
    if (!modelConfig) {
      console.error(`Error: Unknown model '${OPTIONS.modelKey}'. Available: wan_v2.2-14b-fp8_i2v_lightx2v, wan_v2.2-14b-fp8_i2v, ltx2-19b-fp8_i2v_distilled, ltx2-19b-fp8_i2v`);
      process.exit(1);
    }
  }

  log('🎬', `Selected model: ${modelConfig.name}`);

  // Check if model supports end image (LTX-2 models do not)
  const supportsEndImage = !OPTIONS.modelKey.startsWith('ltx');

  // Ask about end image in interactive mode (only for models that support it)
  if (OPTIONS.interactive && !OPTIONS.endImage && supportsEndImage) {
    const useEndImage = await askQuestion('\nAdd end image transition? [y/N]: ');
    if (useEndImage.toLowerCase() === 'y' || useEndImage.toLowerCase() === 'yes') {
      try {
        OPTIONS.endImage = await pickImageFile(null, 'end image');
        log('📸', `End image: ${OPTIONS.endImage}`);
      } catch (error) {
        log('⚠️', 'No end image selected, continuing without interpolation');
      }
    }
  }

  // Warn if end image was provided via CLI for unsupported model
  if (OPTIONS.endImage && !supportsEndImage) {
    log('⚠️', 'End image transitions are not supported by LTX-2 models. End image will be ignored.');
    OPTIONS.endImage = null;
  }

  // Validate end image if provided
  if (OPTIONS.endImage && !fs.existsSync(OPTIONS.endImage)) {
    console.error(`Error: End image '${OPTIONS.endImage}' does not exist`);
    process.exit(1);
  }

  // Set default dimensions from image
  modelConfig.defaultWidth = initialImageDimensions.width;
  modelConfig.defaultHeight = initialImageDimensions.height;

  // Interactive mode: prompt for core options
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
  // Video models only support ComfyUI sampler/scheduler
  if (!OPTIONS.sampler) OPTIONS.sampler = modelConfig.defaultComfySampler || 'euler';
  if (!OPTIONS.scheduler) OPTIONS.scheduler = modelConfig.defaultComfyScheduler || 'simple';
  if (OPTIONS.guidance === undefined || OPTIONS.guidance === null) {
    OPTIONS.guidance = modelConfig.defaultGuidance;
  }
  if (!OPTIONS.steps) OPTIONS.steps = modelConfig.defaultSteps;

  // Use model-specific frame limits
  const maxFrames = modelConfig.maxFrames || VIDEO_CONSTRAINTS.frames.max;

  // Calculate frames from duration if not explicitly set (need this before processing image)
  if (!OPTIONS.frames) {
    const duration = OPTIONS.duration || 5;
    OPTIONS.frames = Math.round(duration * OPTIONS.fps) + 1;
    OPTIONS.frames = Math.max(VIDEO_CONSTRAINTS.frames.min, Math.min(maxFrames, OPTIONS.frames));
  }

  // Process the image - resize if needed for dimension requirements
  let processedImage;
  try {
    processedImage = await processImageForVideo(OPTIONS.image, OPTIONS.frames, {
      targetWidth: OPTIONS.width || initialImageDimensions.width,
      targetHeight: OPTIONS.height || initialImageDimensions.height
    });
    log('📐', `Final video dimensions: ${processedImage.width}x${processedImage.height}`);
  } catch (error) {
    console.error(`Error processing image: ${error.message}`);
    process.exit(1);
  }

  // Use the processed dimensions
  OPTIONS.width = processedImage.width;
  OPTIONS.height = processedImage.height;

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

  // Validate batch count
  if (OPTIONS.batch < 1 || OPTIONS.batch > 512) {
    console.error('Error: Batch count must be between 1 and 512');
    process.exit(1);
  }

  // Create output directory
  if (!fs.existsSync(OPTIONS.output)) {
    fs.mkdirSync(OPTIONS.output, { recursive: true });
  }

  // Initialize client
  const clientConfig = {
    appId: `sogni-workflow-i2v-${Date.now()}`,
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

    // Ask for batch count as last question before confirmation
    if (OPTIONS.interactive) {
      await promptBatchCount(OPTIONS, { isVideo: true });
    }

    // Show configuration first
    const videoDuration = (OPTIONS.frames - 1) / OPTIONS.fps;
    const configDisplay = {
      Model: modelConfig.name,
      Prompt: OPTIONS.prompt,
      Input: OPTIONS.image,
      ...(OPTIONS.endImage && { 'End Image': OPTIONS.endImage }),
      Resolution: `${OPTIONS.width}x${OPTIONS.height}`,
      Duration: `${videoDuration.toFixed(1)}s`,
      FPS: OPTIONS.fps,
      Frames: OPTIONS.frames,
      Steps: OPTIONS.steps,
      Batch: OPTIONS.batch,
      Guidance: OPTIONS.guidance,
      Shift: OPTIONS.shift,
      Seed: OPTIONS.seed !== null ? OPTIONS.seed : -1
    };
    // Video models only support ComfyUI sampler/scheduler
    configDisplay['Comfy Sampler'] = OPTIONS.sampler;
    configDisplay['Comfy Scheduler'] = OPTIONS.scheduler;
    displayConfig('Video Generation Configuration', configDisplay);

    if (OPTIONS.negative) {
      console.log(`   Negative prompt: ${OPTIONS.negative}`);
    }
    if (OPTIONS.style) {
      console.log(`   Style prompt: ${OPTIONS.style}`);
    }

    // Get cost estimate
    log('💵', 'Fetching cost estimate...');
    const estimate = await getVideoJobEstimate(
      tokenType,
      modelConfig.id,
      OPTIONS.width,
      OPTIONS.height,
      OPTIONS.frames,
      OPTIONS.fps,
      OPTIONS.steps
    );

    console.log();
    console.log('📊 Cost Estimate:');

    if (tokenType === 'spark') {
      const costPerVideo = parseFloat(estimate.quote.project.costInSpark || 0);
      const totalCost = costPerVideo * OPTIONS.batch;
      const currentBalance = parseFloat(balance.spark.net || 0);
      if (OPTIONS.batch > 1) {
        console.log(`   Per video: ${costPerVideo.toFixed(2)} Spark`);
        console.log(`   Total (${OPTIONS.batch} videos): ${totalCost.toFixed(2)} Spark`);
      } else {
        console.log(`   Spark: ${totalCost.toFixed(2)}`);
      }
      console.log(
        `   Balance remaining: ${(currentBalance - totalCost).toFixed(2)} Spark`
      );
      console.log(`   USD: $${(totalCost * 0.005).toFixed(4)}`);
    } else {
      const costPerVideo = parseFloat(estimate.quote.project.costInSogni || 0);
      const totalCost = costPerVideo * OPTIONS.batch;
      const currentBalance = parseFloat(balance.sogni.net || 0);
      if (OPTIONS.batch > 1) {
        console.log(`   Per video: ${costPerVideo.toFixed(2)} Sogni`);
        console.log(`   Total (${OPTIONS.batch} videos): ${totalCost.toFixed(2)} Sogni`);
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

    // Wait for models
    log('🔄', 'Loading available models...');
    const models = await sogni.projects.waitForModels();
    const videoModel = models.find((m) => m.id === modelConfig.id);

    if (!videoModel) {
      throw new Error(`Model ${modelConfig.id} not available`);
    }

    log('✓', `Model ready: ${videoModel.name}`);
    console.log();

    // Generate seed client-side if not specified (for reliable filename generation)
    if (OPTIONS.seed === null || OPTIONS.seed === -1) {
      OPTIONS.seed = generateRandomSeed();
      log('🎲', `Generated seed: ${OPTIONS.seed}`);
    }

    // Create project
    log('📤', 'Submitting image-to-video job...');
    log('🎬', 'Generating video from image...');
    console.log();

    // Use the pre-processed image buffer (already resized if needed)
    // Convert Buffer to Blob for SDK upload
    const referenceImageBlob = new Blob([processedImage.buffer]);

    const projectParams = {
      type: 'video',
      modelId: modelConfig.id,
      positivePrompt: OPTIONS.prompt,
      numberOfMedia: OPTIONS.batch,
      width: OPTIONS.width,
      height: OPTIONS.height,
      frames: OPTIONS.frames,
      fps: OPTIONS.fps,
      steps: OPTIONS.steps,
      shift: OPTIONS.shift,
      seed: OPTIONS.seed,
      referenceImage: referenceImageBlob,
      tokenType: tokenType
    };

    // Video models only support ComfyUI sampler/scheduler
    if (OPTIONS.sampler) projectParams.sampler = OPTIONS.sampler;
    if (OPTIONS.scheduler) projectParams.scheduler = OPTIONS.scheduler;

    // Add end image for transition if provided
    if (OPTIONS.endImage) {
      projectParams.referenceImageEnd = readFileAsBuffer(OPTIONS.endImage);
    }

    // Add guidance
    if (OPTIONS.guidance !== undefined && OPTIONS.guidance !== null) {
      projectParams.guidance = OPTIONS.guidance;
    }

    // Add optional prompts
    if (OPTIONS.negative) {
      projectParams.negativePrompt = OPTIONS.negative;
    }
    if (OPTIONS.style) {
      projectParams.stylePrompt = OPTIONS.style;
    }

    project = await sogni.projects.create(projectParams);

    // Set up event handlers
    let completedVideos = 0;
    let failedVideos = 0;
    const totalVideos = OPTIONS.batch;
    let projectFailed = false;

    // Track per-job state for progress display
    const jobStates = new Map(); // jobId -> { startTime, lastStep, lastStepCount, lastETA, lastETAUpdate, interval, jobIndex }
    let activeJobId = null; // Track which job is currently showing progress

    // Helper to get job label (e.g., "Job 1/2")
    function getJobLabel(event, jobId = null) {
      if (totalVideos === 1) return '';
      // First try to get jobIndex from event, then from stored state
      let jobNum = event.jobIndex;
      if (jobNum === undefined && jobId) {
        const state = jobStates.get(jobId);
        if (state?.jobIndex !== undefined) {
          jobNum = state.jobIndex;
        }
      }
      jobNum = jobNum !== undefined ? jobNum + 1 : '?';
      return `[${jobNum}/${totalVideos}] `;
    }

    // Helper to clear progress line
    function clearProgressLine() {
      process.stdout.write('\r' + ' '.repeat(80) + '\r');
    }

    // Helper to stop progress display for a job
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
      if (event.projectId !== project.id) return;
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
          checkWorkflowCompletion();
          break;
      }
    };

    jobEventHandler = (event) => {
      if (event.projectId !== project.id) return;
      const jobId = event.jobId;
      const jobLabel = getJobLabel(event);

      switch (event.type) {
        case 'queued': {
                    const queuedLabel = getJobLabel(event, jobId);
          log('📋', `${queuedLabel}Job queued at position: ${event.queuePosition}`);
          break;
        }

        case 'initiating': {
                    // Pre-create job state with jobIndex if provided
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
                    // Initialize or update state for this job
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
            // Update existing state from initiating
            jobState.startTime = Date.now();
            jobState.lastETAUpdate = Date.now();
            if (event.jobIndex !== undefined) {
              jobState.jobIndex = event.jobIndex;
            }
          }

          // Get job label using stored jobIndex
          const startedLabel = getJobLabel(event, jobId);

          // Start progress display for this job
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
            failedVideos++;
            log('❌', `${completedLabel}Job completed with error: ${event.error || 'No result URL'}`);
            jobStates.delete(jobId);
            checkWorkflowCompletion();
          } else {
            if (projectFailed) {
              log('⚠️', `${completedLabel}Ignoring completion event for already failed project`);
              return;
            }
            log('✅', `${completedLabel}Job completed!`);

            // Calculate elapsed time for THIS job
            const jobElapsedSeconds = state ? (Date.now() - state.startTime) / 1000 : null;
            const jobElapsed = jobElapsedSeconds ? jobElapsedSeconds.toFixed(2) : '?';

            // Use seed + jobIndex for batch jobs (server increments seed per job)
            const jobSeed = OPTIONS.seed + (state?.jobIndex || 0);

            const desiredPath = generateVideoFilename({
              modelId: modelConfig.id,
              frames: OPTIONS.frames,
              fps: OPTIONS.fps,
              width: OPTIONS.width,
              height: OPTIONS.height,
              seed: jobSeed,
              prompt: OPTIONS.prompt,
              generationTime: jobElapsedSeconds,
              outputDir: OPTIONS.output
            });
            const outputPath = getUniqueFilename(desiredPath);

            downloadVideo(event.resultUrl, outputPath)
              .then(() => {
                completedVideos++;
                log('✓', `${completedLabel}Video completed (${jobElapsed}s)`);
                log('💾', `Saved: ${outputPath}`);
                openVideo(outputPath);
                jobStates.delete(jobId);
                checkWorkflowCompletion();
              })
              .catch((error) => {
                failedVideos++;
                log('❌', `${completedLabel}Download failed: ${error.message}`);
                jobStates.delete(jobId);
                checkWorkflowCompletion();
              });
          }
          break;
        }

        case 'error':
        case 'failed': {
                    const errorLabel = getJobLabel(event, jobId);
          stopJobProgress(jobId);
          projectFailed = true;
          failedVideos++;
          const errorMsg = event.error?.message || event.error || 'Unknown error';
          const errorCode = event.error?.code;
          if (errorCode !== undefined && errorCode !== null) {
            log('❌', `${errorLabel}Job failed: ${errorMsg} (Error code: ${errorCode})`);
          } else {
            log('❌', `${errorLabel}Job failed: ${errorMsg}`);
          }
          jobStates.delete(jobId);
          checkWorkflowCompletion();
          break;
        }
      }
    };

    sogni.projects.on('project', projectEventHandler);
    sogni.projects.on('job', jobEventHandler);

    function checkWorkflowCompletion() {
      if (completedVideos + failedVideos === totalVideos) {
        if (failedVideos === 0) {
          if (totalVideos === 1) {
            log('🎉', 'Video generated successfully!');
          } else {
            log('🎉', `All ${totalVideos} videos generated successfully!`);
          }
          console.log();
          // Give a small delay for all video players to open
          process.exit(0);
        } else {
          log(
            '❌',
            `${failedVideos} out of ${totalVideos} video${totalVideos > 1 ? 's' : ''} failed to generate`
          );
          console.log();
          process.exit(1);
        }
      }
    }

    // Wait for all jobs to complete - SDK and server handle their own timeouts
    await new Promise((resolve) => {
      const checkCompletion = () => {
        if (projectFailed || completedVideos + failedVideos >= totalVideos) {
          resolve();
        } else {
          setTimeout(checkCompletion, 1000);
        }
      };
      checkCompletion();
    });

    if (projectFailed || failedVideos > 0) {
      const failureCount = projectFailed ? totalVideos : failedVideos;
      log('❌', `Workflow failed with ${failureCount} failed video${failureCount > 1 ? 's' : ''}`);
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
    // Clean up all per-job progress intervals
    for (const [jobId, state] of jobStates) {
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

async function getVideoJobEstimate(tokenType, modelId, width, height, frames, fps, steps) {
  let baseUrl = process.env.SOGNI_SOCKET_ENDPOINT || 'https://socket.sogni.ai';
  if (baseUrl.startsWith('wss://')) {
    baseUrl = baseUrl.replace('wss://', 'https://');
  } else if (baseUrl.startsWith('ws://')) {
    baseUrl = baseUrl.replace('ws://', 'https://');
  }
  const url = `${baseUrl}/api/v1/job-video/estimate/${tokenType}/${encodeURIComponent(modelId)}/${width}/${height}/${frames}/${fps}/${steps}`;
  console.log(`🔗 Video cost estimate URL: ${url}`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to get cost estimate: ${response.statusText}`);
  }
  return response.json();
}

async function downloadVideo(url, outputPath) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download video: ${response.statusText}`);
  }

  const fileStream = fs.createWriteStream(outputPath);
  await streamPipeline(response.body, fileStream);
}

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
      log('⚠️', `Could not auto-open video: ${error.message}`);
    } else {
      log('🎬', `Opened video in player: ${videoPath}`);
    }
  });
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

