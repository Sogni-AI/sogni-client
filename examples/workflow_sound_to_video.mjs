#!/usr/bin/env node
/**
 * Sound-to-Video Workflow
 *
 * This script generates videos from audio files using WAN 2.2 models.
 * Creates visual content that synchronizes with the provided audio.
 *
 * Prerequisites:
 * - Set SOGNI_USERNAME and SOGNI_PASSWORD in .env file (or will prompt)
 * - You need access to the 'fast' network for video generation
 *
 * Usage:
 *   node workflow_sound_to_video.mjs "person singing and dancing" --audio song.mp3
 *   node workflow_sound_to_video.mjs "musical performance" --audio track.wav --width 768 --height 512
 *   node workflow_sound_to_video.mjs "band playing instruments" --audio music.mp3 --fps 32 --frames 161
 *   node workflow_sound_to_video.mjs "orchestra concert" --audio symphony.wav --model quality --batch 2
 *
 * Options:
 *   --audio     Input audio file path (required)
 *   --prompt    Description of the visual content (default: audio-synchronized defaults)
 *   --width     Video width (default: 640, minimum: 480)
 *   --height    Video height (default: 640, minimum: 480)
 *   --fps       Frames per second: 16 or 32 (default: 16)
 *   --frames    Number of frames, 17-161 (default: 81 = 5 seconds at 16fps)
 *   --model     Model variant: quality or speed (default: prompts for selection)
 *   --batch     Number of videos to generate (default: 1)
 *   --output    Output directory (default: ./videos)
 *   --seed      Random seed for reproducibility (default: random)
 *   --help      Show this help message
 */

import { SogniClient } from '../dist/index.js';
import * as fs from 'node:fs';
import { pipeline } from 'node:stream';
import { promisify } from 'node:util';
import { exec } from 'node:child_process';
import * as readline from 'node:readline';
import { loadCredentials, loadTokenTypePreference, saveTokenTypePreference } from './credentials.mjs';

const streamPipeline = promisify(pipeline);

// Model variants
const MODELS = {
  s2v: {
    speed: {
      id: 'wan_v2.2-14b-fp8_s2v_lightx2v',
      name: 'WAN 2.2 S2V LightX2V (Speed)',
      description: 'Fast sound-to-video generation',
      defaultPrompt: 'A person singing and dancing to music, expressive movements, synchronized to audio'
    },
    quality: {
      id: 'wan_v2.2-14b-fp8_s2v',
      name: 'WAN 2.2 S2V (Quality)',
      description: 'High quality sound-to-video generation',
      defaultPrompt: 'A person singing and dancing to music, expressive movements, synchronized to audio'
    }
  }
};

// Minimum video dimensions for Wan 2.2 models
const MIN_VIDEO_DIMENSION = 480;

// ============================================
// Parse Command Line Arguments
// ============================================

async function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    prompt: null,
    negative: null,
    style: null,
    audio: null,
    width: 640,
    height: 640,
    fps: 16,
    frames: 81,
    model: 'speed', // Default to speed model
    batch: 1,
    seed: null,
    output: './videos',
    interactive: true
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      showHelp();
      process.exit(0);
    } else if (arg === '--no-interactive') {
      options.interactive = false;
    } else if (arg === '--audio' && args[i + 1]) {
      options.audio = args[++i];
    } else if (arg === '--prompt' && args[i + 1]) {
      options.prompt = args[++i];
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
    } else if (arg === '--batch' && args[i + 1]) {
      options.batch = parseInt(args[++i], 10);
    } else if (arg === '--negative' && args[i + 1]) {
      options.negative = args[++i];
    } else if (arg === '--style' && args[i + 1]) {
      options.style = args[++i];
    } else if (arg === '--seed' && args[i + 1]) {
      options.seed = parseInt(args[++i], 10);
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

  // Provide defaults when interactive and missing required parameters
  if (options.interactive && (!options.prompt || !options.audio)) {
    console.log('\n🎵 Sound-to-Video Workflow');
    console.log('=========================\n');

    // Required audio input
    if (!options.audio) {
      const audioInput = await askQuestion('Enter input audio file path (required): ');
      if (audioInput.trim()) {
        options.audio = audioInput.trim();
        if (!fs.existsSync(options.audio)) {
          console.error(`Error: Audio file '${options.audio}' does not exist`);
          process.exit(1);
        }
      } else {
        console.error('Error: Input audio is required');
        process.exit(1);
      }
    }

    // Default prompt
    if (!options.prompt) {
      const defaultPrompt = 'A dynamic music video with performers dancing to the rhythm';
      const promptInput = await askQuestion(`Enter your video description (default: "${defaultPrompt}"): `);
      options.prompt = promptInput.trim() || defaultPrompt;
    }

    // Optional negative prompt
    const negativeInput = await askQuestion('Enter negative prompt (optional, press Enter to skip): ');
    if (negativeInput.trim()) {
      options.negative = negativeInput.trim();
    }

    // Optional style prompt
    const styleInput = await askQuestion('Enter style prompt (optional, press Enter to skip): ');
    if (styleInput.trim()) {
      options.style = styleInput.trim();
    }

    // Model selection (already defaults to speed)
    if (options.model === 'speed') {
      const modelChoice = await askQuestion('Use Speed (fast) or Quality (high quality)? [s/q] (default: s): ');
      if (modelChoice.toLowerCase().startsWith('q')) {
        options.model = 'quality';
      }
    }

    // Video dimensions
    const widthInput = await askQuestion(`Video width (default: ${options.width}): `);
    if (widthInput.trim()) {
      const widthNum = parseInt(widthInput.trim(), 10);
      if (widthNum >= MIN_VIDEO_DIMENSION) {
        options.width = widthNum;
      }
    }

    const heightInput = await askQuestion(`Video height (default: ${options.height}): `);
    if (heightInput.trim()) {
      const heightNum = parseInt(heightInput.trim(), 10);
      if (heightNum >= MIN_VIDEO_DIMENSION) {
        options.height = heightNum;
      }
    }

    // Batch count
    const batchInput = await askQuestion('Number of videos to generate (default: 1): ');
    if (batchInput.trim()) {
      const batchNum = parseInt(batchInput.trim(), 10);
      if (batchNum > 0 && batchNum <= 5) {
        options.batch = batchNum;
      }
    }

    console.log('\n✅ Configuration complete!\n');
  } else {
    if (!options.audio) {
      console.error('Error: Input audio is required (use --help for options)');
      showHelp();
      process.exit(1);
    }
    if (!options.prompt) {
      console.error('Error: Prompt is required (use --help for options)');
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
  node workflow_sound_to_video.mjs "person singing and dancing" --audio song.mp3
  node workflow_sound_to_video.mjs "musical performance" --audio track.wav --width 768 --height 512

Options:
  --audio     Input audio file path (required)
  --prompt    Description of the visual content (default: audio-synchronized defaults)
  --negative  Negative prompt (default: server default)
  --style     Style prompt (default: server default)
  --width     Video width (default: 640, minimum: 480)
  --height    Video height (default: 640, minimum: 480)
  --fps       Frames per second: 16 or 32 (default: 16)
  --frames    Number of frames, 17-161 (default: 81 = 5 seconds at 16fps)
  --model     Model variant: quality or speed (default: speed)
  --batch     Number of videos to generate (default: 1)
  --output    Output directory (default: ./videos)
  --seed      Random seed for reproducibility (default: random)
  --no-interactive  Skip interactive prompts (default: interactive mode)
  --help      Show this help message
`);
}

// ============================================
// Interactive Prompts
// ============================================

async function askQuestion(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(typeof answer === 'string' ? answer : '');
    });
  });
}

async function selectModelVariant() {
  console.log('\n🎵 Select WAN 2.2 Model Variant:');
  console.log('  1. Quality - High quality, slower generation');
  console.log('  2. Speed   - Fast generation, good quality');
  console.log();

  const choice = await askQuestion('Enter choice [1/2] (default: 2): ');
  const selected = choice.trim() || '2';

  if (selected === '1' || selected.toLowerCase() === 'quality') {
    return 'quality';
  } else if (selected === '2' || selected.toLowerCase() === 'speed') {
    return 'speed';
  } else {
    console.log('Invalid choice, using Speed variant');
    return 'speed';
  }
}

// ============================================
// Utility Functions
// ============================================

function log(icon, message) {
  console.log(`${icon} ${message}`);
}

function formatDuration(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Get audio duration using ffprobe
 */
async function getAudioDuration(audioPath) {
  return new Promise((resolve, reject) => {
    exec(`ffprobe -v quiet -print_format json -show_format "${audioPath}"`, (error, stdout) => {
      if (error) {
        reject(new Error(`Failed to get audio duration: ${error.message}`));
        return;
      }

      try {
        const data = JSON.parse(stdout);
        const duration = parseFloat(data.format.duration);
        resolve(duration);
      } catch (parseError) {
        reject(new Error(`Failed to parse audio duration: ${parseError.message}`));
      }
    });
  });
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

  // Validate input audio
  if (!fs.existsSync(OPTIONS.audio)) {
    console.error(`Error: Input audio '${OPTIONS.audio}' does not exist`);
    process.exit(1);
  }

  // Get audio duration
  let audioDuration = 5.0; // Default fallback
  try {
    audioDuration = await getAudioDuration(OPTIONS.audio);
    log('🎵', `Audio duration: ${audioDuration.toFixed(1)} seconds`);
  } catch (error) {
    log('⚠️', `Could not detect audio duration, using default: ${audioDuration}s`);
  }

  // Adjust frames based on audio duration if needed
  const suggestedFrames = Math.min(161, Math.max(17, Math.round(audioDuration * OPTIONS.fps)));
  if (Math.abs(OPTIONS.frames - suggestedFrames) > 10) {
    log('⚠️', `Suggested frames for ${audioDuration.toFixed(1)}s audio: ${suggestedFrames} (current: ${OPTIONS.frames})`);
  }

  // Determine model variant
  let modelVariant = OPTIONS.model;
  if (!modelVariant) {
    modelVariant = await selectModelVariant();
  }

  const modelConfig = MODELS.s2v[modelVariant];
  if (!modelConfig) {
    console.error(`Error: Unknown model variant '${modelVariant}'`);
    process.exit(1);
  }

  log('🎵', `Selected model: ${modelConfig.name}`);

  // Validate dimensions
  if (OPTIONS.width < MIN_VIDEO_DIMENSION) {
    console.error(`Error: Video width must be at least ${MIN_VIDEO_DIMENSION}px for WAN 2.2 models (got ${OPTIONS.width})`);
    process.exit(1);
  }
  if (OPTIONS.height < MIN_VIDEO_DIMENSION) {
    console.error(`Error: Video height must be at least ${MIN_VIDEO_DIMENSION}px for WAN 2.2 models (got ${OPTIONS.height})`);
    process.exit(1);
  }

  // Validate FPS
  if (OPTIONS.fps !== 16 && OPTIONS.fps !== 32) {
    console.error('Error: FPS must be 16 or 32');
    process.exit(1);
  }

  // Validate frames
  if (OPTIONS.frames < 17 || OPTIONS.frames > 161) {
    console.error('Error: Frames must be between 17 and 161');
    process.exit(1);
  }

  // Validate batch count
  if (OPTIONS.batch < 1 || OPTIONS.batch > 5) {
    console.error('Error: Batch count must be between 1 and 5');
    process.exit(1);
  }

  // Set prompt
  const prompt = OPTIONS.prompt || modelConfig.defaultPrompt;

  // Create output directory
  if (!fs.existsSync(OPTIONS.output)) {
    fs.mkdirSync(OPTIONS.output, { recursive: true });
  }

  // Initialize client
  const clientConfig = {
    appId: `sogni-workflow-s2v-${Date.now()}`,
    network: 'fast'
  };

  // Load optional configuration from environment
  const testnet = process.env.SOGNI_TESTNET === 'true';
  const socketEndpoint = process.env.SOGNI_SOCKET_ENDPOINT;
  const restEndpoint = process.env.SOGNI_REST_ENDPOINT;

  // Only disable SSL verification if testnet is enabled
  if (testnet) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  }

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
      const tokenChoiceTrimmed = tokenChoice.trim() || '1';

      if (tokenChoiceTrimmed === '2' || tokenChoiceTrimmed.toLowerCase() === 'sogni') {
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
    const estimate = await getVideoJobEstimate(tokenType, modelConfig.id, OPTIONS.width, OPTIONS.height, OPTIONS.frames, OPTIONS.fps, 1);

    console.log();
    console.log('📊 Cost Estimate:');

    // Show the cost in the selected token type and USD
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
        return;
      }
    } else {
      console.log('✓ Proceeding with generation (non-interactive mode)');
    }

    // Show configuration
    console.log();
    console.log('┌─────────────────────────────────────────────────────────┐');
    console.log('│ Video Generation Configuration                          │');
    console.log('├─────────────────────────────────────────────────────────┤');

    const labelWidth = 12;
    const boxWidth = 58;

    console.log(`│ ${'Model:'.padEnd(labelWidth)}${modelConfig.name.padEnd(boxWidth - labelWidth - 2)} │`);
    console.log(`│ ${'Input:'.padEnd(labelWidth)}${OPTIONS.audio.slice(0, boxWidth - labelWidth - 2).padEnd(boxWidth - labelWidth - 2)} │`);
    console.log(`│ ${'Audio:'.padEnd(labelWidth)}${(audioDuration.toFixed(1) + 's').padEnd(boxWidth - labelWidth - 2)} │`);
    console.log(`│ ${'Resolution:'.padEnd(labelWidth)}${(OPTIONS.width + 'x' + OPTIONS.height).padEnd(boxWidth - labelWidth - 2)} │`);
    console.log(`│ ${'Duration:'.padEnd(labelWidth)}${((OPTIONS.frames / OPTIONS.fps).toFixed(1) + 's').padEnd(boxWidth - labelWidth - 2)} │`);
    console.log(`│ ${'FPS:'.padEnd(labelWidth)}${String(OPTIONS.fps).padEnd(boxWidth - labelWidth - 2)} │`);
    console.log(`│ ${'Frames:'.padEnd(labelWidth)}${String(OPTIONS.frames).padEnd(boxWidth - labelWidth - 2)} │`);
    console.log(`│ ${'Batch:'.padEnd(labelWidth)}${String(OPTIONS.batch).padEnd(boxWidth - labelWidth - 2)} │`);
    if (OPTIONS.seed !== null) {
      console.log(`│ ${'Seed:'.padEnd(labelWidth)}${String(OPTIONS.seed).padEnd(boxWidth - labelWidth - 2)} │`);
    }
    console.log('└─────────────────────────────────────────────────────────┘');
    console.log();
    console.log('📝 Prompts:');
    console.log(`   Positive: ${prompt}`);
    if (OPTIONS.negative) {
      console.log(`   Negative: ${OPTIONS.negative}`);
    }
    if (OPTIONS.style) {
      console.log(`   Style: ${OPTIONS.style}`);
    }
    console.log();

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
    log('🎵', 'Generating video from audio...');
    console.log();

    let startTime = Date.now();
    const projectParams = {
      type: 'video',
      modelId: modelConfig.id,
      positivePrompt: prompt,
      numberOfMedia: OPTIONS.batch,
      width: OPTIONS.width,
      height: OPTIONS.height,
      frames: OPTIONS.frames,
      fps: OPTIONS.fps,
      seed: OPTIONS.seed,
      referenceAudio: OPTIONS.audio,
      tokenType: tokenType
    };

    // Add optional prompts if provided
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
          // Start timing when job actually starts
          if (!project._progressInterval) {
            startTime = Date.now();
            // Show progress and update every second throughout the entire job
            project._progressInterval = setInterval(() => {
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
            }, 1000);
          }
          log('🚀', `Job started on worker: ${event.workerName || 'Unknown'}`);
          break;

        case 'jobETA':
          // Store the latest ETA so the interval can use it
          project._lastETA = event.etaSeconds;
          break;

        case 'progress':
          // Progress events update step count (optional display)
          break;

        case 'completed':
          // Clear the progress interval and show final message
          if (project._progressInterval) {
            clearInterval(project._progressInterval);
            project._progressInterval = null;
            // Clear the line
            process.stdout.write('\r' + ' '.repeat(70) + '\r');
          }

          // Check if this completion event indicates failure
          if (!event.resultUrl || event.error) {
            failedVideos++;
            log('❌', `Job completed with error: ${event.error || 'No result URL'}`);
            checkWorkflowCompletion();
          } else {
            // If project has already failed, ignore successful completions
            if (projectFailed) {
              log('⚠️', `Ignoring completion event for already failed project`);
              return;
            }
            log('✅', 'Job completed!');
            // Start download - defer success counting until download completes
            const videoId = event.jobId || `video_${Date.now()}`;
            const outputPath = `${OPTIONS.output}/${videoId}.mp4`;

            downloadVideo(event.resultUrl, outputPath)
              .then(() => {
                // Download succeeded - now count as completed
                completedVideos++;
                const elapsed = Math.round((Date.now() - startTime) / 1000);
                log('✓', `Video ${completedVideos}/${totalVideos} completed (${elapsed}s)`);
                log('💾', `Saved: ${outputPath}`);
                openVideo(outputPath);

                // Check if workflow is complete
                checkWorkflowCompletion();
              })
              .catch((error) => {
                // Download failed - count as failed
                failedVideos++;
                log('❌', `Download failed for ${videoId}: ${error.message}`);

                // Check if workflow is complete
                checkWorkflowCompletion();
              });
          }
          break;

        case 'error':
        case 'failed':
          // Clear the progress interval
          if (project._progressInterval) {
            clearInterval(project._progressInterval);
            project._progressInterval = null;
            process.stdout.write('\r' + ' '.repeat(70) + '\r');
          }
          projectFailed = true;
          failedVideos++;
          log('❌', `Job failed: ${event.error?.message || event.error || 'Unknown error'}`);
          if (event.error?.code) {
            console.log(`   Error code: ${event.error.code}`);
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
          log('🎉', `All ${totalVideos} video${totalVideos > 1 ? 's' : ''} generated successfully!`);
          console.log();
          process.exit(0);
        } else {
          log('❌', `${failedVideos} out of ${totalVideos} video${totalVideos > 1 ? 's' : ''} failed to generate`);
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

      // Timeout after 60 minutes
      setTimeout(() => {
        reject(new Error('Generation timed out after 60 minutes'));
      }, 60 * 60 * 1000);

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
    // Clean up event handlers
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
      // Ignore logout errors
    }
  }
}

/**
 * Get video job cost estimate
 */
async function getVideoJobEstimate(tokenType, modelId, width, height, frames, fps, steps) {
  // Use configured socket endpoint or default, convert wss to https for HTTP requests
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

  if (platform === 'darwin') { // macOS
    command = `open "${videoPath}"`;
  } else if (platform === 'win32') { // Windows
    command = `start "" "${videoPath}"`;
  } else { // Linux and others
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
