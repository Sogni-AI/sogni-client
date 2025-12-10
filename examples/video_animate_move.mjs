/**
 * Animate-Move Example using WAN 2.2 Speed LoRA (LightX2V)
 *
 * This example demonstrates how to transfer motion from a reference video
 * to a subject in a reference image using the animate-move workflow.
 *
 * Prerequisites:
 * - You need a Sogni account with access to the fast supernet
 * - Video generation requires the 'fast' network (not 'relaxed')
 * - Edit USERNAME and PASSWORD below with your credentials
 *
 * Usage:
 *   node video_animate_move.mjs
 */

import * as fs from 'node:fs';
import { pipeline } from 'node:stream';
import { promisify } from 'node:util';
import * as readline from 'node:readline';
// When running from the repo, import from local dist
// When published to npm, users would import from '@sogni-ai/sogni-client'
import { SogniClient } from '../dist/index.js';

// ============================================
// Configuration - Edit these values
// ============================================

const USERNAME = 'YOUR_USERNAME';
const PASSWORD = 'YOUR_PASSWORD';

// WAN 2.2 14B FP8 animate-move with speed LoRA (4-step inference)
const VIDEO_MODEL_ID = 'wan_v2.2-14b-fp8_animate-move_lightx2v';

// Reference assets for animate-move workflow
const REFERENCE_IMAGE = './examples/test-assets/placeholder.jpg'; // Subject to animate
const REFERENCE_VIDEO = './examples/test-assets/placeholder.mp4'; // Motion source

const VIDEO_CONFIG = {
  frames: 81,
  fps: 16,
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
  console.log('Sogni Animate-Move Example');
  console.log('='.repeat(60));
  console.log();

  // Verify reference assets exist
  if (!fs.existsSync(REFERENCE_IMAGE)) {
    console.error(`Error: Reference image not found: ${REFERENCE_IMAGE}`);
    console.error('Please provide a reference image file.');
    process.exit(1);
  }
  if (!fs.existsSync(REFERENCE_VIDEO)) {
    console.error(`Error: Reference video not found: ${REFERENCE_VIDEO}`);
    console.error('Please provide a reference video file.');
    process.exit(1);
  }
  console.log(`Reference image (subject): ${REFERENCE_IMAGE}`);
  console.log(`Reference video (motion): ${REFERENCE_VIDEO}`);
  console.log();

  const client = await SogniClient.createInstance({
    appId: `${USERNAME}-animate-move-${Date.now()}`,
    network: 'fast',
  });

  let projectEventHandler;
  let jobEventHandler;

  try {
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
      'spark',
      VIDEO_MODEL_ID,
      480,
      832,
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
      await client.account.logout();
      process.exit(0);
    }

    console.log();

    console.log('Loading available models...');
    const models = await client.projects.waitForModels();

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
      await client.account.logout();
      process.exit(1);
    }

    log('✓', `Model ready: ${videoModel.name}`);
    console.log();

    const outputDuration = (VIDEO_CONFIG.frames - 1) / VIDEO_CONFIG.fps;
    console.log('Video Configuration:');
    console.log(`  - Frames: ${VIDEO_CONFIG.frames} (${outputDuration}s output at ${VIDEO_CONFIG.fps}fps)`);
    console.log(`  - FPS: ${VIDEO_CONFIG.fps}`);
    console.log();

    log('📤', 'Submitting video generation job...');
    log('⏳', '(This may take a few minutes)');
    console.log();

    const startTime = Date.now();

    // Load the reference assets
    const referenceImageBuffer = fs.readFileSync(REFERENCE_IMAGE);
    const referenceVideoBuffer = fs.readFileSync(REFERENCE_VIDEO);

    const project = await client.projects.create({
    modelId: VIDEO_MODEL_ID,
    positivePrompt: 'Smooth natural motion, high quality animation, realistic movement',
    negativePrompt: 'blurry, low quality, distorted, artifacts, watermark, text, jittery',
    stylePrompt: '',
    numberOfImages: 1,
    video: {
      ...VIDEO_CONFIG,
      referenceImage: referenceImageBuffer,
      referenceVideo: referenceVideoBuffer,
    },
    tokenType: 'spark',
    width: 480,
    height: 832,
  });

    console.log(`Project created: ${project.id}`);
    console.log();

    let isComplete = false;

    const progressHandler = (progress) => {
      if (isComplete) return;
      const elapsed = (Date.now() - startTime) / 1000;
      const pct = Math.min(100, Math.max(0, Number(progress) || 0));
      const filled = Math.floor(pct / 5);
      const bar = '█'.repeat(filled) + '░'.repeat(20 - filled);
      process.stdout.write(`\r  Progress: [${bar}] ${pct}% (${formatDuration(elapsed)} elapsed)`);
    };
    project.on('progress', progressHandler);

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
          console.log(`\n  Job started on worker: ${event.workerName || 'Unknown'}`);
          break;
        case 'jobETA': {
          const elapsed = (Date.now() - startTime) / 1000;
          const etaFormatted = formatDuration(event.etaSeconds);
          process.stdout.write(`\r  Generating... ETA: ${etaFormatted} (${formatDuration(elapsed)} elapsed)   `);
          break;
        }
        case 'completed':
          log('✅', 'Job completed!');
          break;
        case 'error':
          log('❌', `Job failed: ${event.error.message}`);
          break;
      }
    };

    client.projects.on('project', projectEventHandler);
    client.projects.on('job', jobEventHandler);

    console.log('Generating animated video...');
    console.log('(This may take a few minutes)');
    console.log();

    try {
      const videoUrls = await project.waitForCompletion();
      isComplete = true;
      const totalTime = (Date.now() - startTime) / 1000;

      console.log('\n');
      console.log('='.repeat(60));
      console.log('Video generation complete!');
      console.log('='.repeat(60));
      console.log(`Total time: ${formatDuration(totalTime)}`);
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
      project.off('progress', progressHandler);
      if (projectEventHandler) {
        client.projects.off('project', projectEventHandler);
      }
      if (jobEventHandler) {
        client.projects.off('job', jobEventHandler);
      }
      try {
        await client.account.logout();
        console.log('Logged out.');
      } catch {}
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
