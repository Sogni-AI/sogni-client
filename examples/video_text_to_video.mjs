/**
 * Text-to-Video Example using WAN 2.2 Speed LoRA (LightX2V)
 *
 * This example demonstrates how to generate a 5-second video from a text prompt
 * using the fast 4-step inference model (WAN 2.2 14B FP8 t2v LightX2V).
 *
 * Prerequisites:
 * - You need a Sogni account with access to the fast supernet
 * - Video generation requires the 'fast' network (not 'relaxed')
 * - Edit USERNAME and PASSWORD below with your credentials
 *
 * Usage:
 *   node video_text_to_video.mjs
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

// WAN 2.2 14B FP8 text-to-video with speed LoRA (4-step inference)
const VIDEO_MODEL_ID = 'wan_v2.2-14b-fp8_t2v_lightx2v';

// Video parameters - only specify what you want to override
// All other parameters (steps, guidance, shift, etc.) use model defaults
const VIDEO_CONFIG = {
  // Note: WAN 2.2 requires +1 frames due to a quirk in the model
  // 81 frames = 80 output frames = 5 seconds at 16fps
  frames: 81,
  // Output FPS: 16 (standard) or 32 (with frame interpolation, +20% processing time)
  fps: 16,
};

// Output directory
const OUTPUT_DIR = './videos';

const streamPipeline = promisify(pipeline);

// ============================================
// Helper Functions
// ============================================

/**
 * Ensure output directory exists
 */
function ensureOutputDir() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
}

/**
 * Download a file from URL to local path
 */
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

/**
 * Download a preview image
 */
async function downloadPreview(url, projectId, step) {
  const filename = `preview_${projectId}_step${step}.jpg`;
  return downloadFile(url, filename, 'preview');
}

/**
 * Download the final video
 */
async function downloadVideo(url, projectId, index) {
  const filename = `video_${projectId}_${index}.mp4`;
  return downloadFile(url, filename, 'video');
}

/**
 * Format seconds into MM:SS
 */
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
  console.log('Sogni Text-to-Video Example');
  console.log('='.repeat(60));
  console.log();

  // Client configuration
  const client = await SogniClient.createInstance({
    appId: `${USERNAME}-video-generator-${Date.now()}`,
    network: 'fast', // Video models only available on fast network
  });

  console.log('Logging in...');
  await client.account.login(USERNAME, PASSWORD);
  console.log(`Logged in as: ${USERNAME}`);
  console.log();

  // Wait for models to load
  console.log('Loading available models...');
  const models = await client.projects.waitForModels();

  // Find our video model
  const videoModel = models.find((m) => m.id === VIDEO_MODEL_ID);
  if (!videoModel) {
    const videoModels = models.filter((m) => m.media === 'video');
    console.log(`Model ${VIDEO_MODEL_ID} not found.`);
    if (videoModels.length === 0) {
      console.log('No video models currently available on the fast network.');
      console.log('Video workers may be offline. Please try again later.');
    } else {
      console.log('Available video models:');
      videoModels.forEach((m) => console.log(`  - ${m.id} (${m.name})`));
    }
    try {
      await client.account.logout();
    } catch {
      // Ignore logout errors
    }
    process.exit(1);
  }

  console.log(`Using model: ${videoModel.name} (${videoModel.id})`);
  console.log();

  // Video parameters
  const outputDuration = (VIDEO_CONFIG.frames - 1) / VIDEO_CONFIG.fps;
  console.log('Video Configuration:');
  console.log(`  - Frames: ${VIDEO_CONFIG.frames} (${outputDuration}s output at ${VIDEO_CONFIG.fps}fps)`);
  console.log(`  - FPS: ${VIDEO_CONFIG.fps}`);
  console.log('  - Steps, guidance, shift: using model defaults');
  console.log();

  // Create the video project
  console.log('Creating video project...');
  const startTime = Date.now();

  const project = await client.projects.create({
    modelId: VIDEO_MODEL_ID,
    positivePrompt: 'A majestic eagle soaring through cloudy mountain peaks at golden hour, cinematic lighting, epic scale',
    negativePrompt: 'blurry, low quality, distorted, artifacts, watermark, text',
    stylePrompt: '',
    numberOfImages: 1,
    video: VIDEO_CONFIG,
    tokenType: 'spark',
  });

  console.log(`Project created: ${project.id}`);
  console.log();

  // Track downloaded previews to avoid duplicates
  const downloadedPreviews = new Set();
  let isComplete = false;

  // Listen for progress events
  const progressHandler = (progress) => {
    if (isComplete) return;
    const elapsed = (Date.now() - startTime) / 1000;
    const pct = Math.min(100, Math.max(0, Number(progress) || 0));
    const filled = Math.floor(pct / 5);
    const bar = '█'.repeat(filled) + '░'.repeat(20 - filled);
    process.stdout.write(`\r  Progress: [${bar}] ${pct}% (${formatDuration(elapsed)} elapsed)`);
  };
  project.on('progress', progressHandler);

  // Listen for job events and download previews as they arrive
  const jobHandler = async (event) => {
    if (event.projectId !== project.id) return;

    if (event.type === 'started') {
      console.log(`\n  Job started on worker: ${event.workerName || 'Unknown'}`);
    } else if (event.type === 'preview' && event.url) {
      const step = event.step || 0;
      const previewKey = `${event.jobId}-${step}`;

      if (!downloadedPreviews.has(previewKey)) {
        downloadedPreviews.add(previewKey);
        try {
          const path = await downloadPreview(event.url, project.id, step);
          console.log(`\n  Preview saved: ${path}`);
        } catch (err) {
          console.log(`\n  Preview download failed: ${err.message}`);
        }
      }
    }
  };
  client.projects.on('job', jobHandler);

  // Wait for completion
  console.log('Generating video...');
  console.log('(This may take a few minutes for a 5-second video)');
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
      const url = videoUrls[i];
      const path = await downloadVideo(url, project.id, i + 1);
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

  // Cleanup listeners
  project.off('progress', progressHandler);
  client.projects.off('job', jobHandler);

  try {
    await client.account.logout();
    console.log('Logged out.');
  } catch {
    // Ignore logout errors
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
