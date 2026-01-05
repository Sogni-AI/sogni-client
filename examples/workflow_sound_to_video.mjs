#!/usr/bin/env node
/**
 * Sound-to-Video Workflow
 *
 * This script generates videos from audio files and reference images using WAN 2.2 S2V models.
 * The generated video is lip-synced/motion-synced to the audio input.
 *
 * Prerequisites:
 * - Set SOGNI_USERNAME and SOGNI_PASSWORD in .env file (or will prompt)
 * - You need access to the 'fast' network for video generation
 *
 * Usage:
 *   node workflow_sound_to_video.mjs --image person.jpg --audio speech.m4a
 *   node workflow_sound_to_video.mjs "A person speaking" --image face.jpg --audio voice.mp3
 *
 * Options:
 *   --image       Reference image path (required)
 *   --audio       Audio file path (required, m4a/mp3/wav)
 *   --audio-start Start position in audio in seconds (default: 0)
 *   --audio-duration  Duration of audio to use in seconds (default: auto from video)
 *   --model       Model: lightx2v or quality (default: prompts for selection)
 *   --width       Video width (default: auto from image, min: 480)
 *   --height      Video height (default: auto from image, min: 480)
 *   --duration    Duration in seconds (default: 5, converts to frames)
 *   --fps         Frames per second: 16 or 32 (default: 16)
 *   --batch       Number of videos to generate (default: 1)
 *   --seed        Random seed for reproducibility (default: -1 for random)
 *   --guidance    Guidance scale (default: model-specific)
 *   --shift       Motion intensity 1.0-8.0 (default: 8.0)
 *   --comfy-sampler  ComfyUI sampler name (default: uni_pc for s2v)
 *   --comfy-scheduler ComfyUI scheduler name (default: simple)
 *   --negative    Negative prompt (default: none)
 *   --style       Style prompt (default: none)
 *   --output      Output directory (default: ./output)
 *   --no-interactive  Skip interactive prompts
 *   --help        Show this help message
 */

import { SogniClient } from '../dist/index.js';
import * as fs from 'node:fs';
import { pipeline } from 'node:stream';
import { promisify } from 'node:util';
import { exec } from 'node:child_process';
import imageSize from 'image-size';
import { loadCredentials, loadTokenTypePreference, saveTokenTypePreference } from './credentials.mjs';
import {
  MODELS,
  VIDEO_CONSTRAINTS,
  askQuestion,
  selectModel,
  promptCoreOptions,
  promptVideoDuration,
  promptAdvancedOptions,
  promptS2VOptions,
  pickImageFile,
  pickAudioFile,
  readFileAsBuffer,
  log,
  formatDuration,
  displayConfig,
  displayPrompts
} from './workflow-helpers.mjs';

const streamPipeline = promisify(pipeline);

// Default prompt for this workflow
const DEFAULT_PROMPT = 'A person speaking naturally with synchronized lip movements to the audio';

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
    audio: null,
    audioStart: undefined,
    audioDuration: undefined,
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
    comfySampler: null,
    comfyScheduler: null,
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
    } else if (arg === '--audio' && args[i + 1]) {
      options.audio = args[++i];
    } else if (arg === '--audio-start' && args[i + 1]) {
      options.audioStart = parseFloat(args[++i]);
    } else if (arg === '--audio-duration' && args[i + 1]) {
      options.audioDuration = parseFloat(args[++i]);
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
      options.comfySampler = args[++i];
    } else if (arg === '--comfy-scheduler' && args[i + 1]) {
      options.comfyScheduler = args[++i];
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
Sound-to-Video Workflow

Usage:
  node workflow_sound_to_video.mjs --image person.jpg --audio speech.m4a
  node workflow_sound_to_video.mjs "A person speaking" --image face.jpg --audio voice.mp3

Available Models:
  lightx2v - WAN 2.2 14B S2V LightX2V (fast, 4-step, default)
  quality  - WAN 2.2 14B S2V (high quality, 20-step)

Options:
  --image       Reference image path (required)
  --audio       Audio file path (required, m4a/mp3/wav)
  --audio-start Start position in audio in seconds (default: 0)
  --audio-duration  Duration of audio to use in seconds (default: auto from video)
  --model       Model: lightx2v or quality (default: prompts for selection)
  --negative    Negative prompt (default: none)
  --style       Style prompt (default: none)
  --width       Video width (default: auto from image, min: 480)
  --height      Video height (default: auto from image, min: 480)
  --duration    Duration in seconds (default: 5)
  --fps         Frames per second: 16 or 32 (default: 16)
  --batch       Number of videos to generate (default: 1)
  --seed        Random seed (default: -1 for random)
  --guidance    Guidance scale (default: model-specific)
  --shift       Motion intensity 1.0-8.0 (default: 8.0)
  --comfy-sampler  ComfyUI sampler name (default: uni_pc for s2v)
  --comfy-scheduler ComfyUI scheduler name (default: simple)
  --output      Output directory (default: ./output)
  --no-interactive  Skip interactive prompts
  --help        Show this help message

Audio Options:
  S2V workflows allow you to specify which portion of the audio to use:
  - audioStart: Where to begin reading from the audio file (in seconds)
  - audioDuration: How many seconds of audio to use (calculated from video length if not set)
`);
}

// ============================================
// Utility Functions
// ============================================

/**
 * Get audio duration using ffprobe
 */
async function getAudioDuration(audioPath) {
  return new Promise((resolve, reject) => {
    const command = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`;
    exec(command, (error, stdout, stderr) => {
      if (error) {
        // Try alternative command for macOS
        const altCommand = `afinfo "${audioPath}" | grep duration | awk '{print $2}'`;
        exec(altCommand, (altError, altStdout) => {
          if (altError) {
            log('⚠️', 'Could not detect audio duration (ffprobe/afinfo not available)');
            resolve(10); // Default to 10 seconds
          } else {
            const duration = parseFloat(altStdout.trim());
            resolve(isNaN(duration) ? 10 : duration);
          }
        });
      } else {
        const duration = parseFloat(stdout.trim());
        resolve(isNaN(duration) ? 10 : duration);
      }
    });
  });
}

/**
 * Ensure dimensions are even
 */
function ensureEvenDimensions(width, height) {
  return {
    width: width % 2 === 0 ? width : width - 1,
    height: height % 2 === 0 ? height : height - 1
  };
}

// ============================================
// Main Logic
// ============================================

async function main() {
  const OPTIONS = await parseArgs();

  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║              Sound-to-Video Workflow                     ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log();

  // Load credentials
  const { username: USERNAME, password: PASSWORD } = await loadCredentials();

  // Interactive mode: get image path if not provided
  if (OPTIONS.interactive && !OPTIONS.image) {
    OPTIONS.image = await pickImageFile(null, 'reference image');
  }

  // Interactive mode: get audio path if not provided
  if (OPTIONS.interactive && !OPTIONS.audio) {
    OPTIONS.audio = await pickAudioFile(null, 'audio file');
  }

  // Validate required inputs
  if (!OPTIONS.image) {
    console.error('Error: Reference image is required (use --image option)');
    process.exit(1);
  }
  if (!fs.existsSync(OPTIONS.image)) {
    console.error(`Error: Reference image '${OPTIONS.image}' does not exist`);
    process.exit(1);
  }

  if (!OPTIONS.audio) {
    console.error('Error: Audio file is required (use --audio option)');
    process.exit(1);
  }
  if (!fs.existsSync(OPTIONS.audio)) {
    console.error(`Error: Audio file '${OPTIONS.audio}' does not exist`);
    process.exit(1);
  }

  // Get image dimensions
  let imageInfo = { width: 640, height: 640 };
  try {
    const dimensions = imageSize(OPTIONS.image);
    if (dimensions.width && dimensions.height) {
      imageInfo = { width: dimensions.width, height: dimensions.height };
    }
    log('📐', `Image dimensions: ${imageInfo.width}x${imageInfo.height}`);
  } catch (error) {
    log('⚠️', 'Could not read image dimensions, using defaults');
  }

  // Get audio duration
  log('🎵', 'Analyzing audio file...');
  const audioDuration = await getAudioDuration(OPTIONS.audio);
  log('🎵', `Audio duration: ${audioDuration.toFixed(1)}s`);

  // Interactive mode: select model and options
  let modelConfig;
  if (OPTIONS.interactive && !OPTIONS.modelKey) {
    const selection = await selectModel(MODELS.s2v, 'lightx2v');
    OPTIONS.modelKey = selection.key;
    modelConfig = selection.config;
  } else {
    OPTIONS.modelKey = OPTIONS.modelKey || 'lightx2v';
    modelConfig = MODELS.s2v[OPTIONS.modelKey];
    if (!modelConfig) {
      console.error(`Error: Unknown model '${OPTIONS.modelKey}'. Use 'lightx2v' or 'quality'.`);
      process.exit(1);
    }
  }

  log('🎬', `Selected model: ${modelConfig.name}`);

  // Set default dimensions from image
  modelConfig.defaultWidth = imageInfo.width;
  modelConfig.defaultHeight = imageInfo.height;

  // Interactive mode: prompt for options
  if (OPTIONS.interactive) {
    await promptCoreOptions(OPTIONS, modelConfig, {
      defaultPrompt: DEFAULT_PROMPT,
      isVideo: true
    });

    // Video duration
    await promptVideoDuration(OPTIONS, modelConfig);

    // S2V-specific options
    await promptS2VOptions(OPTIONS, audioDuration);

    // Ask about advanced options
    const advancedChoice = await askQuestion('\nCustomize advanced options? [y/N]: ');
    if (advancedChoice.toLowerCase() === 'y' || advancedChoice.toLowerCase() === 'yes') {
      await promptAdvancedOptions(OPTIONS, modelConfig, { isVideo: true });
    }

    console.log('\n✅ Configuration complete!\n');
  }

  // Apply defaults
  if (!OPTIONS.prompt) OPTIONS.prompt = DEFAULT_PROMPT;
  if (!OPTIONS.fps) OPTIONS.fps = VIDEO_CONSTRAINTS.fps.default;
  if (!OPTIONS.shift) OPTIONS.shift = modelConfig.defaultShift;
  // Video models only support ComfyUI sampler/scheduler
  if (!OPTIONS.comfySampler) OPTIONS.comfySampler = modelConfig.defaultComfySampler || 'uni_pc';
  if (!OPTIONS.comfyScheduler) OPTIONS.comfyScheduler = modelConfig.defaultComfyScheduler || 'simple';
  if (OPTIONS.guidance === undefined || OPTIONS.guidance === null) {
    OPTIONS.guidance = modelConfig.defaultGuidance;
  }

  // Use model-specific frame limits (S2V supports up to 321 frames)
  const maxFrames = modelConfig.maxFrames || VIDEO_CONSTRAINTS.frames.max;

  // Set dimensions with video constraints
  let { width, height } = ensureEvenDimensions(
    OPTIONS.width || imageInfo.width,
    OPTIONS.height || imageInfo.height
  );

  // Validate minimum dimensions
  if (width < VIDEO_CONSTRAINTS.width.min) {
    width = VIDEO_CONSTRAINTS.width.min;
    log('⚠️', `Width adjusted to minimum: ${width}px`);
  }
  if (height < VIDEO_CONSTRAINTS.height.min) {
    height = VIDEO_CONSTRAINTS.height.min;
    log('⚠️', `Height adjusted to minimum: ${height}px`);
  }

  OPTIONS.width = width;
  OPTIONS.height = height;

  // Calculate frames from duration if not explicitly set
  if (!OPTIONS.frames) {
    const duration = OPTIONS.duration || 5;
    OPTIONS.frames = Math.round(duration * OPTIONS.fps) + 1;
    OPTIONS.frames = Math.max(VIDEO_CONSTRAINTS.frames.min, Math.min(maxFrames, OPTIONS.frames));
  }

  // Validate FPS
  if (OPTIONS.fps !== 16 && OPTIONS.fps !== 32) {
    console.error('Error: FPS must be 16 or 32');
    process.exit(1);
  }

  // Validate frames
  if (OPTIONS.frames < VIDEO_CONSTRAINTS.frames.min || OPTIONS.frames > maxFrames) {
    console.error(`Error: Frames must be between ${VIDEO_CONSTRAINTS.frames.min} and ${maxFrames}`);
    process.exit(1);
  }

  // Validate batch count
  if (OPTIONS.batch < 1 || OPTIONS.batch > 5) {
    console.error('Error: Batch count must be between 1 and 5');
    process.exit(1);
  }

  // Validate audio options
  if (OPTIONS.audioStart !== undefined && OPTIONS.audioStart < 0) {
    console.error('Error: Audio start must be >= 0');
    process.exit(1);
  }
  if (OPTIONS.audioDuration !== undefined && OPTIONS.audioDuration <= 0) {
    console.error('Error: Audio duration must be > 0');
    process.exit(1);
  }

  // Create output directory
  if (!fs.existsSync(OPTIONS.output)) {
    fs.mkdirSync(OPTIONS.output, { recursive: true });
  }

  // Initialize client
  const clientConfig = {
    appId: `sogni-workflow-s2v-${Date.now()}`,
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
      console.log(`💳 Using saved payment preference: ${tokenType.charAt(0).toUpperCase() + tokenType.slice(1)} tokens`);
      console.log();
    }

    // Show configuration first
    const videoDuration = (OPTIONS.frames - 1) / OPTIONS.fps;
    const configDisplay = {
      'Model': modelConfig.name,
      'Prompt': OPTIONS.prompt,
      'Image': OPTIONS.image,
      'Audio': OPTIONS.audio,
      'Audio Start': `${(OPTIONS.audioStart || 0).toFixed(1)}s`,
      'Resolution': `${OPTIONS.width}x${OPTIONS.height}`,
      'Duration': `${videoDuration.toFixed(1)}s`,
      'FPS': OPTIONS.fps,
      'Frames': OPTIONS.frames,
      'Batch': OPTIONS.batch,
      'Guidance': OPTIONS.guidance,
      'Shift': OPTIONS.shift,
      'Seed': OPTIONS.seed !== null ? OPTIONS.seed : -1
    };
    // Video models only support ComfyUI sampler/scheduler
    configDisplay['Comfy Sampler'] = OPTIONS.comfySampler;
    configDisplay['Comfy Scheduler'] = OPTIONS.comfyScheduler;

    if (OPTIONS.audioDuration !== undefined) {
      configDisplay['Audio Duration'] = `${OPTIONS.audioDuration.toFixed(1)}s`;
    }

    displayConfig('Video Generation Configuration', configDisplay);

    if (OPTIONS.negative) {
      console.log(`   Negative prompt: ${OPTIONS.negative}`);
    }
    if (OPTIONS.style) {
      console.log(`   Style prompt: ${OPTIONS.style}`);
    }

    // Get cost estimate
    log('💵', 'Fetching cost estimate...');
    const estimate = await getVideoJobEstimate(tokenType, modelConfig.id, OPTIONS.width, OPTIONS.height, OPTIONS.frames, OPTIONS.fps, modelConfig.defaultSteps);

    console.log();
    console.log('📊 Cost Estimate:');

    if (tokenType === 'spark') {
      const cost = parseFloat(estimate.quote.project.costInSpark || 0);
      const currentBalance = parseFloat(balance.spark.net || 0);
      console.log(`   Spark: ${cost.toFixed(2)} (Balance remaining: ${(currentBalance - cost).toFixed(2)})`);
      console.log(`   USD: $${(cost * 0.005).toFixed(4)}`);
    } else {
      const cost = parseFloat(estimate.quote.project.costInSogni || 0);
      const currentBalance = parseFloat(balance.sogni.net || 0);
      console.log(`   Sogni: ${cost.toFixed(2)} (Balance remaining: ${(currentBalance - cost).toFixed(2)})`);
      console.log(`   USD: $${(cost * 0.05).toFixed(4)}`);
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

    // Create project
    log('📤', 'Submitting sound-to-video job...');
    log('🎬', 'Generating video from sound...');
    console.log();

    let startTime = Date.now();

    // CRITICAL: SDK requires Buffer/File/Blob objects for media uploads, NOT string paths.
    // Passing string paths will silently fail (the string text gets uploaded instead of file contents).
    const referenceImageBuffer = readFileAsBuffer(OPTIONS.image);
    const referenceAudioBuffer = readFileAsBuffer(OPTIONS.audio);

    const projectParams = {
      type: 'video',
      modelId: modelConfig.id,
      positivePrompt: OPTIONS.prompt,
      numberOfMedia: OPTIONS.batch,
      width: OPTIONS.width,
      height: OPTIONS.height,
      frames: OPTIONS.frames,
      fps: OPTIONS.fps,
      shift: OPTIONS.shift,
      seed: OPTIONS.seed !== null ? OPTIONS.seed : -1,
      referenceImage: referenceImageBuffer,
      referenceAudio: referenceAudioBuffer,
      tokenType: tokenType
    };

    // Video models only support ComfyUI sampler/scheduler
    if (OPTIONS.comfySampler) projectParams.comfySampler = OPTIONS.comfySampler;
    if (OPTIONS.comfyScheduler) projectParams.comfyScheduler = OPTIONS.comfyScheduler;

    // Add S2V-specific audio options
    if (OPTIONS.audioStart !== undefined) {
      projectParams.audioStart = OPTIONS.audioStart;
    }
    if (OPTIONS.audioDuration !== undefined) {
      projectParams.audioDuration = OPTIONS.audioDuration;
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

    project._lastETA = undefined;
    project._progressInterval = null;

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
      switch (event.type) {
        case 'initiating':
          log('⚙️', `Model initiating on worker: ${event.workerName || 'Unknown'}`);
          break;

        case 'started':
          if (!project._progressInterval) {
            startTime = Date.now();
            project._progressInterval = setInterval(() => {
              const elapsed = (Date.now() - startTime) / 1000;
              let progressStr = `\r  Generating...`;
              if (project._lastStep !== undefined && project._lastStepCount !== undefined) {
                const stepPercent = Math.round((project._lastStep / project._lastStepCount) * 100);
                progressStr += ` Step ${project._lastStep}/${project._lastStepCount} (${stepPercent}%)`;
              }
              if (project._lastETA !== undefined) {
                progressStr += ` ETA: ${formatDuration(project._lastETA)}`;
              }
              progressStr += ` (${formatDuration(elapsed)} elapsed)   `;
              process.stdout.write(progressStr);
            }, 1000);
          }
          log('🚀', `Job started on worker: ${event.workerName || 'Unknown'}`);
          break;

        case 'jobETA':
          project._lastETA = event.etaSeconds;
          break;

        case 'progress':
          // Store step progress for display
          if (event.step !== undefined && event.stepCount !== undefined) {
            project._lastStep = event.step;
            project._lastStepCount = event.stepCount;
          }
          break;

        case 'completed':
          if (project._progressInterval) {
            clearInterval(project._progressInterval);
            project._progressInterval = null;
            process.stdout.write('\r' + ' '.repeat(70) + '\r');
          }

          if (!event.resultUrl || event.error) {
            failedVideos++;
            log('❌', `Job completed with error: ${event.error || 'No result URL'}`);
            checkWorkflowCompletion();
          } else {
            if (projectFailed) {
              log('⚠️', 'Ignoring completion event for already failed project');
              return;
            }
            log('✅', 'Job completed!');
            const videoId = event.jobId || `video_${Date.now()}`;
            const outputPath = `${OPTIONS.output}/${videoId}.mp4`;

            downloadVideo(event.resultUrl, outputPath)
              .then(() => {
                completedVideos++;
                const elapsed = Math.round((Date.now() - startTime) / 1000);
                log('✓', `Video ${completedVideos}/${totalVideos} completed (${elapsed}s)`);
                log('💾', `Saved: ${outputPath}`);
                openVideo(outputPath);
                checkWorkflowCompletion();
              })
              .catch((error) => {
                failedVideos++;
                log('❌', `Download failed for ${videoId}: ${error.message}`);
                checkWorkflowCompletion();
              });
          }
          break;

        case 'error':
        case 'failed':
          if (project._progressInterval) {
            clearInterval(project._progressInterval);
            project._progressInterval = null;
            process.stdout.write('\r' + ' '.repeat(70) + '\r');
          }
          projectFailed = true;
          failedVideos++;
          const errorMsg = event.error?.message || event.error || 'Unknown error';
          const errorCode = event.error?.code;
          if (errorCode !== undefined && errorCode !== null) {
            log('❌', `Job failed: ${errorMsg} (Error code: ${errorCode})`);
          } else {
            log('❌', `Job failed: ${errorMsg}`);
          }
          checkWorkflowCompletion();
          break;
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
          log('❌', `${failedVideos} out of ${totalVideos} video${totalVideos > 1 ? 's' : ''} failed to generate`);
          console.log();
          process.exit(1);
        }
      }
    }

    await new Promise((resolve, reject) => {
      const checkCompletion = () => {
        if (projectFailed || completedVideos + failedVideos >= totalVideos) {
          resolve();
        } else {
          setTimeout(checkCompletion, 1000);
        }
      };

      setTimeout(() => {
        reject(new Error('Generation timed out after 60 minutes'));
      }, 60 * 60 * 1000);

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
    if (project && project._progressInterval) {
      clearInterval(project._progressInterval);
    }
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
