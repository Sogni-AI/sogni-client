/**
 * Sound-to-Video Example using WAN 2.2 (s2v)
 *
 * This example demonstrates how to generate a video from a reference image
 * and audio track using the WAN 2.2 14B FP8 s2v model.
 * The generated video will be synchronized to the audio.
 *
 * Prerequisites:
 * - You need a Sogni account with access to the fast supernet
 * - Video generation requires the 'fast' network (not 'relaxed')
 * - Set SOGNI_USERNAME and SOGNI_PASSWORD in .env file (or will prompt)
 *
 * Usage:
 *   node video_sound_to_video.mjs
 *   node video_sound_to_video.mjs --model wan_v2.2-14b-fp8_s2v_lightx2v
 */

import * as fs from 'node:fs';
import { pipeline } from 'node:stream';
import { promisify } from 'node:util';
import * as readline from 'node:readline';
// When running from the repo, import from local dist
// When published to npm, users would import from '@sogni-ai/sogni-client'
import { SogniClient } from '../dist/index.js';
import { loadCredentials, loadTokenTypePreference, saveTokenTypePreference } from './credentials.mjs';

// ============================================
// Configuration - Edit these values
// ============================================

// Model variants
const MODELS = {
  s2v: {
    speed: 'wan_v2.2-14b-fp8_s2v_lightx2v',
    quality: 'wan_v2.2-14b-fp8_s2v'
  }
};

// Parse command line args
const args = process.argv.slice(2);
const modelArg = args.find((arg, i) => arg === '--model' && args[i + 1]);
const MODEL_EXPLICIT = !!modelArg;
let VIDEO_MODEL_ID = modelArg ? args[args.indexOf(modelArg) + 1] : null;

// Reference assets for s2v workflow
const REFERENCE_IMAGE = './examples/test-assets/placeholder.jpg';
const REFERENCE_AUDIO = './examples/test-assets/placeholder.m4a';

const VIDEO_CONFIG = {
  fps: 16,
  frames: 81 // 5 seconds (16 fps * 5 seconds = 80 frames + 1 frame WAN2.2 quirk)
};

const OUTPUT_DIR = './videos';
const streamPipeline = promisify(pipeline);

// ============================================
// Helper Functions
// ============================================

async function askSpeedOrQuality() {
  // If model was explicitly set, use it
  if (MODEL_EXPLICIT) {
    return VIDEO_MODEL_ID;
  }

  // If not TTY, default to speed
  if (!process.stdin.isTTY) {
    return MODELS.s2v.speed;
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
        resolve(MODELS.s2v.quality);
      } else {
        console.log('  → Using Speed mode\n');
        resolve(MODELS.s2v.speed);
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
  const filename = `video_s2v_${projectId}_${index}.mp4`;
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
  console.log('Sogni Sound-to-Video (s2v via Wan 2.2 14B)');
  console.log('='.repeat(60));
  console.log();

  // Load credentials from .env or prompt user
  const { username: USERNAME, password: PASSWORD } = await loadCredentials();

  // Verify reference assets exist
  if (!fs.existsSync(REFERENCE_IMAGE)) {
    console.error(`Error: Reference image not found: ${REFERENCE_IMAGE}`);
    console.error('Please provide a reference image file.');
    process.exit(1);
  }
  if (!fs.existsSync(REFERENCE_AUDIO)) {
    console.error(`Error: Reference audio not found: ${REFERENCE_AUDIO}`);
    console.error('Please provide a reference audio file.');
    process.exit(1);
  }
  console.log(`Reference image: ${REFERENCE_IMAGE}`);
  console.log(`Reference audio: ${REFERENCE_AUDIO}`);
  console.log();

  // Prompt for model if not specified
  if (!VIDEO_MODEL_ID) {
    VIDEO_MODEL_ID = await askSpeedOrQuality();
  }

  const sogni = await SogniClient.createInstance({
    appId: `${USERNAME}-s2v-generator-${Date.now()}`,
    network: 'fast'
  });

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
      480,
      832,
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
    console.log(
      `  - Frames: ${VIDEO_CONFIG.frames} (${outputDuration}s output at ${VIDEO_CONFIG.fps}fps)`
    );
    console.log(`  - FPS: ${VIDEO_CONFIG.fps}`);
    console.log();

    log('📤', 'Submitting video generation job...');
    log('⏳', '(This may take a few minutes)');
    console.log();

    // Load the reference assets
    const referenceImageBuffer = fs.readFileSync(REFERENCE_IMAGE);
    const referenceAudioBuffer = fs.readFileSync(REFERENCE_AUDIO);

    let startTime = null;

    project = await sogni.projects.create({
      ...VIDEO_CONFIG,
      type: 'video',
      modelId: VIDEO_MODEL_ID,
      numberOfMedia: 1,
      positivePrompt:
        'A person singing and dancing to music, expressive movements, synchronized to audio',
      negativePrompt: 'blurry, low quality, distorted, artifacts, watermark, text',
      referenceImage: referenceImageBuffer,
      referenceAudio: referenceAudioBuffer,
      tokenType: tokenType,
      width: 480,
      height: 832
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

    console.log('Generating video from sound...');
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
