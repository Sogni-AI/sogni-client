#!/usr/bin/env node
/**
 * Text-to-Video Workflow
 *
 * This script generates videos from text prompts using WAN 2.2 models.
 * Supports quality/speed variants with configurable dimensions and frame rates.
 *
 * Prerequisites:
 * - Set SOGNI_USERNAME and SOGNI_PASSWORD in .env file (or will prompt)
 * - You need access to the 'fast' network for video generation
 *
 * Usage:
 *   node workflow_text_to_video.mjs                           # Interactive mode
 *   node workflow_text_to_video.mjs "A futuristic city"       # With prompt
 *   node workflow_text_to_video.mjs "Dancing robots" --fps 32 # With options
 *
 * Options:
 *   --model     Model: lightx2v or quality (default: prompts for selection)
 *   --width     Video width (default: 832, min: 480)
 *   --height    Video height (default: 480, min: 480)
 *   --duration  Duration in seconds (default: 5, converts to frames)
 *   --fps       Frames per second: 16 or 32 (default: 16)
 *   --batch     Number of videos to generate (default: 1)
 *   --seed      Random seed for reproducibility (default: -1 for random)
 *   --guidance  Guidance scale (default: model-specific)
 *   --shift     Motion intensity 1.0-8.0 (default: model-specific)
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
  log,
  formatDuration,
  displayConfig,
  displayPrompts
} from './workflow-helpers.mjs';

const streamPipeline = promisify(pipeline);

// Default prompt for this workflow
const DEFAULT_PROMPT =
  '**Shot in black and white.** A grainy, 16mm black and white archival film. An actor is dressed as an astronaut and is walking on the moon, back to the camera, looking at an American flag. The scene is framed like an iconic, high-contrast NASA photograph from the 1960s. The camera, maintaining its 1960s black and white film quality, begins a slow, deliberate zoom out and pan to the right. The motion is smooth, as if on a studio dolly. As the camera pulls back, the artificial edges of a film set, including scaffolding and large studio lights, start to enter the frame. The shot resolves into a wide-angle view of a massive film studio soundstage, all in grainy, high-contrast black and white. The moon landing is revealed to be a detailed set. Surrounding it, a busy 1960s-era film crew is at work: a director in a collared shirt watches intently, technicians in vests adjust large boom microphones, and crew members operate massive studio lights. The entire scene has the authentic look and feel of a behind-the-scenes documentary from that era. ';

// ============================================
// Parse Command Line Arguments
// ============================================

async function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    prompt: null,
    negative: null,
    style: null,
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
Text-to-Video Workflow

Usage:
  node workflow_text_to_video.mjs                           # Interactive mode
  node workflow_text_to_video.mjs "your prompt here"        # With prompt
  node workflow_text_to_video.mjs "Dancing" --model quality # With specific model

Available Models:
  lightx2v - WAN 2.2 14B T2V LightX2V (fast, 4-step, default)
  quality  - WAN 2.2 14B T2V (high quality, 20-step)

Options:
  --model     Model: lightx2v or quality (default: prompts for selection)
  --negative  Negative prompt (default: none)
  --style     Style prompt (default: none)
  --width     Video width (default: 832, min: 480, max: 1536)
  --height    Video height (default: 480, min: 480, max: 1536)
  --duration  Duration in seconds (default: 5)
  --fps       Frames per second: 16 or 32 (default: 16)
  --batch     Number of videos to generate (default: 1)
  --seed      Random seed (default: -1 for random)
  --guidance  Guidance scale (default: model-specific)
  --shift     Motion intensity 1.0-8.0 (default: model-specific)
  --comfy-sampler  ComfyUI sampler name (default: euler)
  --comfy-scheduler ComfyUI scheduler name (default: simple)
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
  console.log('║               Text-to-Video Workflow                     ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log();

  // Load credentials
  const { username: USERNAME, password: PASSWORD } = await loadCredentials();

  // Interactive mode: select model and options
  let modelConfig;
  if (OPTIONS.interactive && !OPTIONS.modelKey) {
    const selection = await selectModel(MODELS.t2v, 'lightx2v');
    OPTIONS.modelKey = selection.key;
    modelConfig = selection.config;
  } else {
    OPTIONS.modelKey = OPTIONS.modelKey || 'lightx2v';
    modelConfig = MODELS.t2v[OPTIONS.modelKey];
    if (!modelConfig) {
      console.error(`Error: Unknown model '${OPTIONS.modelKey}'. Use 'lightx2v' or 'quality'.`);
      process.exit(1);
    }
  }

  log('🎬', `Selected model: ${modelConfig.name}`);
  console.log();

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

  // Apply defaults for non-interactive mode
  if (!OPTIONS.prompt) OPTIONS.prompt = DEFAULT_PROMPT;
  if (!OPTIONS.width) OPTIONS.width = VIDEO_CONSTRAINTS.width.default;
  if (!OPTIONS.height) OPTIONS.height = VIDEO_CONSTRAINTS.height.default;
  if (!OPTIONS.fps) OPTIONS.fps = VIDEO_CONSTRAINTS.fps.default;
  if (!OPTIONS.shift) OPTIONS.shift = modelConfig.defaultShift;
  // Video models only support ComfyUI sampler/scheduler
  if (!OPTIONS.sampler) {
    OPTIONS.sampler = modelConfig.defaultComfySampler || 'euler';
  }
  if (!OPTIONS.scheduler) {
    OPTIONS.scheduler = modelConfig.defaultComfyScheduler || 'simple';
  }
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

  // Validate dimensions
  OPTIONS.width = Math.max(
    VIDEO_CONSTRAINTS.width.min,
    Math.min(VIDEO_CONSTRAINTS.width.max, OPTIONS.width)
  );
  OPTIONS.height = Math.max(
    VIDEO_CONSTRAINTS.height.min,
    Math.min(VIDEO_CONSTRAINTS.height.max, OPTIONS.height)
  );

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

  // Create output directory
  if (!fs.existsSync(OPTIONS.output)) {
    fs.mkdirSync(OPTIONS.output, { recursive: true });
  }

  // Initialize client
  const clientConfig = {
    appId: `sogni-workflow-t2v-${Date.now()}`,
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

    // Show configuration
    const videoDuration = (OPTIONS.frames - 1) / OPTIONS.fps;
    displayConfig('Video Generation Configuration', {
      Model: modelConfig.name,
      Prompt: OPTIONS.prompt,
      Resolution: `${OPTIONS.width}x${OPTIONS.height}`,
      Duration: `${videoDuration.toFixed(1)}s`,
      FPS: OPTIONS.fps,
      Frames: OPTIONS.frames,
      Batch: OPTIONS.batch,
      Guidance: OPTIONS.guidance,
      Shift: OPTIONS.shift,
      Seed: OPTIONS.seed !== null ? OPTIONS.seed : -1,
      'Comfy Sampler': OPTIONS.sampler,
      'Comfy Scheduler': OPTIONS.scheduler
    });

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
      1
    );

    console.log();
    console.log('📊 Cost Estimate:');

    if (tokenType === 'spark') {
      const cost = parseFloat(estimate.quote.project.costInSpark || 0);
      const currentBalance = parseFloat(balance.spark.net || 0);
      console.log(
        `   Spark: ${cost.toFixed(2)} (Balance remaining: ${(currentBalance - cost).toFixed(2)})`
      );
      console.log(`   USD: $${(cost * 0.005).toFixed(4)}`);
    } else {
      const cost = parseFloat(estimate.quote.project.costInSogni || 0);
      const currentBalance = parseFloat(balance.sogni.net || 0);
      console.log(
        `   Sogni: ${cost.toFixed(2)} (Balance remaining: ${(currentBalance - cost).toFixed(2)})`
      );
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
    log('📤', 'Submitting text-to-video job...');
    log('🎬', 'Generating video...');
    console.log();

    let startTime = Date.now();
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
      // Use sampler/scheduler for video models (ComfyUI format)
      sampler: OPTIONS.sampler,
      scheduler: OPTIONS.scheduler,
      tokenType: tokenType
    };

    // Add optional prompts
    if (OPTIONS.negative) {
      projectParams.negativePrompt = OPTIONS.negative;
    }
    if (OPTIONS.style) {
      projectParams.stylePrompt = OPTIONS.style;
    }

    // Add guidance
    if (OPTIONS.guidance !== undefined && OPTIONS.guidance !== null) {
      projectParams.guidance = OPTIONS.guidance;
    }

    project = await sogni.projects.create(projectParams);

    // Set up event handlers
    let completedVideos = 0;
    let failedVideos = 0;
    const totalVideos = OPTIONS.batch;
    let projectFailed = false;

    // Track ETA and progress interval
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
            project._lastETAUpdate = Date.now(); // Track when ETA was last updated
            project._progressInterval = setInterval(() => {
              const elapsed = (Date.now() - startTime) / 1000;
              let progressStr = `\r  Generating...`;
              if (project._lastStep !== undefined && project._lastStepCount !== undefined) {
                const stepPercent = Math.round((project._lastStep / project._lastStepCount) * 100);
                progressStr += ` Step ${project._lastStep}/${project._lastStepCount} (${stepPercent}%)`;
              }
              if (project._lastETA !== undefined) {
                // Calculate adjusted ETA based on time elapsed since last update
                const elapsedSinceUpdate = (Date.now() - project._lastETAUpdate) / 1000;
                const adjustedETA = Math.max(1, project._lastETA - elapsedSinceUpdate);
                progressStr += ` ETA: ${formatDuration(adjustedETA)}`;
              }
              progressStr += ` (${formatDuration(elapsed)} elapsed)   `;
              process.stdout.write(progressStr);
            }, 1000);
          }
          log('🚀', `Job started on worker: ${event.workerName || 'Unknown'}`);
          break;

        case 'jobETA':
          project._lastETA = event.etaSeconds;
          project._lastETAUpdate = Date.now();
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
                const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
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

    // Helper function to check workflow completion
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

    // Wait for completion or project failure
    await new Promise((resolve, reject) => {
      const checkCompletion = () => {
        if (projectFailed || completedVideos + failedVideos >= totalVideos) {
          resolve();
        } else {
          setTimeout(checkCompletion, 1000);
        }
      };

      setTimeout(
        () => {
          reject(new Error('Generation timed out after 60 minutes'));
        },
        60 * 60 * 1000
      );

      checkCompletion();
    });

    // Final status check
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
  console.log(`🔗 Video cost estimate URL: ${url}`);
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
      log('⚠️', `Could not auto-open video: ${error.message}`);
    } else {
      log('🎬', `Opened video in player: ${videoPath}`);
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
