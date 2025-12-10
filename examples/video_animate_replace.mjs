/**
 * Animate-Replace Example using WAN 2.2 Speed LoRA (LightX2V)
 *
 * This example demonstrates how to replace the subject in a reference video
 * with a subject from a reference image while preserving the original motion.
 *
 * Prerequisites:
 * - You need a Sogni account with access to the fast supernet
 * - Video generation requires the 'fast' network (not 'relaxed')
 * - Edit USERNAME and PASSWORD below with your credentials
 *
 * Usage:
 *   node video_animate_replace.mjs
 */

import * as fs from 'node:fs';
import { pipeline } from 'node:stream';
import { promisify } from 'node:util';
// When running from the repo, import from local dist
// When published to npm, users would import from '@sogni-ai/sogni-client'
import { SogniClient } from '../dist/index.js';

// ============================================
// Configuration - Edit these values
// ============================================

const USERNAME = 'YOUR_USERNAME';
const PASSWORD = 'YOUR_PASSWORD';

// WAN 2.2 14B FP8 animate-replace with speed LoRA (4-step inference)
const VIDEO_MODEL_ID = 'wan_v2.2-14b-fp8_animate-replace_lightx2v';

// Reference assets for animate-replace workflow
const REFERENCE_IMAGE = './examples/test-assets/placeholder.jpg'; // New subject
const REFERENCE_VIDEO = './examples/test-assets/placeholder.mp4'; // Video with subject to replace

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
  const filename = `video_animate-replace_${projectId}_${index}.mp4`;
  return downloadFile(url, filename, 'video');
}

function formatDuration(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// ============================================
// Main
// ============================================

async function main() {
  console.log('='.repeat(60));
  console.log('Sogni Animate-Replace Example');
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
  console.log(`Reference image (new subject): ${REFERENCE_IMAGE}`);
  console.log(`Reference video (motion source): ${REFERENCE_VIDEO}`);

  const client = await SogniClient.createInstance({
    appId: `${USERNAME}-animate-replace-${Date.now()}`,
    network: 'fast',
  });

  console.log('Logging in...');
  await client.account.login(USERNAME, PASSWORD);
  console.log(`Logged in as: ${USERNAME}`);
  console.log();

  console.log('Loading available models...');
  const models = await client.projects.waitForModels();

  const videoModel = models.find((m) => m.id === VIDEO_MODEL_ID);
  if (!videoModel) {
    const videoModels = models.filter((m) => m.media === 'video');
    console.log(`Model ${VIDEO_MODEL_ID} not found.`);
    if (videoModels.length === 0) {
      console.log('No video models currently available on the fast network.');
    } else {
      console.log('Available video models:');
      videoModels.forEach((m) => console.log(`  - ${m.id} (${m.name})`));
    }
    try { await client.account.logout(); } catch {}
    process.exit(1);
  }

  console.log(`Using model: ${videoModel.name} (${videoModel.id})`);
  console.log();

  const outputDuration = (VIDEO_CONFIG.frames - 1) / VIDEO_CONFIG.fps;
  console.log('Video Configuration:');
  console.log(`  - Frames: ${VIDEO_CONFIG.frames} (${outputDuration}s output at ${VIDEO_CONFIG.fps}fps)`);
  console.log(`  - FPS: ${VIDEO_CONFIG.fps}`);
  console.log();

  console.log('Creating video project...');
  const startTime = Date.now();

  // Load the reference assets
  const referenceImageBuffer = fs.readFileSync(REFERENCE_IMAGE);
  const referenceVideoBuffer = fs.readFileSync(REFERENCE_VIDEO);

  const project = await client.projects.create({
    modelId: VIDEO_MODEL_ID,
    positivePrompt: 'Seamless subject replacement, natural motion preserved, high quality',
    negativePrompt: 'blurry, low quality, distorted, artifacts, watermark, text, flickering',
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

  const jobHandler = async (event) => {
    if (event.projectId !== project.id) return;
    switch (event.type) {
      case 'started':
        console.log(`\n  Job started on worker: ${event.workerName || 'Unknown'}`);
        break;
      case 'jobETA': {
        const elapsed = (Date.now() - startTime) / 1000;
        const etaFormatted = formatDuration(event.etaSeconds);
        process.stdout.write(`\r  Generating... ETA: ${etaFormatted} (${formatDuration(elapsed)} elapsed)   `);
        break;
      }
    }
  };
  client.projects.on('job', jobHandler);

  console.log('Generating video with replaced subject...');
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
  }

  project.off('progress', progressHandler);
  client.projects.off('job', jobHandler);

  try {
    await client.account.logout();
    console.log('Logged out.');
  } catch {}
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
}).then(() => {
  process.exit(0);
});
