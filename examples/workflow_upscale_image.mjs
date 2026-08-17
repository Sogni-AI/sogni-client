#!/usr/bin/env node
/**
 * Image Upscaling Workflow (RTX VSR, up to 16K)
 *
 * This script enlarges an existing image with the NVIDIA RTX Video Super
 * Resolution model (rtx_vsr_pro). RTX VSR is deterministic reconstruction,
 * not a generative edit: it takes no prompt and preserves the source image's
 * content, identity, composition, and colors while increasing resolution.
 *
 * Output bounds: the longest output edge can be up to 15360px, every output
 * edge must be at least 512px, and dimensions are aligned down to multiples
 * of 8. Aspect ratio is always preserved.
 *
 * Prerequisites:
 * - Set SOGNI_API_KEY or SOGNI_USERNAME/SOGNI_PASSWORD in .env file (or will prompt)
 * - You need access to the 'fast' network
 *
 * Usage:
 *   node workflow_upscale_image.mjs                              # Interactive mode
 *   node workflow_upscale_image.mjs --image ./photo.png          # Upscale to the 16K maximum
 *   node workflow_upscale_image.mjs --image ./photo.png --scale 2
 *   node workflow_upscale_image.mjs --image ./photo.png --target 3840   # 4K UHD longest edge
 *
 * Options:
 *   --image     Source image to upscale (default: prompts for selection)
 *   --scale     Relative enlargement: 2, 3, or 4 (ignored when --target is given)
 *   --target    Longest-edge target in pixels, 512-15360 (default: 15360 when --scale is not given)
 *   --output    Output directory (default: ./output)
 *   --billing-mode  auto | subscription | tokens (default: auto)
 *   --no-interactive  Skip interactive prompts
 *   --help      Show this help message
 */

import * as fs from 'node:fs';
import { pipeline } from 'node:stream';
import { promisify } from 'node:util';
import { exec } from 'node:child_process';
import imageSize from 'image-size';
import { loadCredentials, loadTokenTypePreference, saveTokenTypePreference } from './credentials.mjs';
import {
  askQuestion,
  billingModeHelpText,
  billingModeLabel,
  createSogniConnection,
  pickImageFile,
  readFileAsBuffer,
  log,
  displayConfig,
  getUniqueFilename,
  generateImageFilename,
  defaultBillingMode,
  defaultExamplesOutputDir,
  parseBillingModeArg,
  shouldCheckTokenBalance
} from './workflow-helpers.mjs';

const streamPipeline = promisify(pipeline);

const RTX_VSR_MODEL_ID = 'rtx_vsr_pro';
const RTX_VSR_MIN_EDGE = 512;
// Keep in sync with the SDK's own ceiling in src/lib/validation.ts
// (getCustomImageSizeBounds, RTX_VSR_MAX_EDGE); the server enforces it too.
const RTX_VSR_MAX_EDGE = 15360;
const RTX_VSR_DIMENSION_STEP = 8;
const ALLOWED_SCALES = [2, 3, 4];

// ============================================
// Parse Command Line Arguments
// ============================================

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    image: null,
    scale: null,
    target: null,
    output: defaultExamplesOutputDir(),
    interactive: true,
    billingMode: defaultBillingMode()
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const billingModeIndex = parseBillingModeArg(args, i, options);
    if (billingModeIndex !== null) {
      i = billingModeIndex;
    } else if (arg === '--help' || arg === '-h') {
      showHelp();
      process.exit(0);
    } else if (arg === '--no-interactive') {
      options.interactive = false;
    } else if (arg === '--image' && args[i + 1]) {
      options.image = args[++i];
    } else if (arg === '--scale' && args[i + 1]) {
      options.scale = parseInt(args[++i], 10);
    } else if (arg === '--target' && args[i + 1]) {
      options.target = parseInt(args[++i], 10);
    } else if (arg === '--output' && args[i + 1]) {
      options.output = args[++i];
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
Image Upscaling Workflow (RTX VSR, up to 16K)

Deterministically enlarges an image with NVIDIA RTX Video Super Resolution.
No prompt, no repainting: content, identity, composition, and colors are
preserved. Longest output edge up to ${RTX_VSR_MAX_EDGE}px.

Usage:
  node workflow_upscale_image.mjs                              # Interactive mode
  node workflow_upscale_image.mjs --image ./photo.png          # Upscale to the 16K maximum
  node workflow_upscale_image.mjs --image ./photo.png --scale 2
  node workflow_upscale_image.mjs --image ./photo.png --target 3840

Options:
  --image     Source image to upscale (default: prompts for selection)
  --scale     Relative enlargement: ${ALLOWED_SCALES.join(', ')} (ignored when --target is given)
  --target    Longest-edge target in pixels, ${RTX_VSR_MIN_EDGE}-${RTX_VSR_MAX_EDGE} (default: ${RTX_VSR_MAX_EDGE} when --scale is not given)
  --output    Output directory (default: ./output)
${billingModeHelpText()}
  --no-interactive  Skip interactive prompts
  --help      Show this help message
`);
}

// ============================================
// RTX VSR Output Dimensions
// ============================================

// Mirrors the server-side RTX VSR validator: cap the longest edge at
// RTX_VSR_MAX_EDGE, keep every edge >= 512, align each edge down to a
// multiple of 8.
function resolveUpscaleDimensions(source, scale) {
  const longest = Math.max(source.width, source.height);
  if (!Number.isFinite(longest) || source.width <= 0 || source.height <= 0) {
    throw new Error('The source image has invalid dimensions.');
  }
  if (longest >= RTX_VSR_MAX_EDGE) {
    throw new Error(
      `The source image is already ${longest}px on its longest edge; RTX VSR only upscales up to ${RTX_VSR_MAX_EDGE}px.`
    );
  }
  if (!(scale > 1)) {
    throw new Error('The upscaled output must be larger than the source image.');
  }
  const cappedScale = Math.min(scale, RTX_VSR_MAX_EDGE / longest);
  const align = (value) => Math.floor(value / RTX_VSR_DIMENSION_STEP) * RTX_VSR_DIMENSION_STEP;
  const width = align(source.width * cappedScale);
  const height = align(source.height * cappedScale);
  if (width < RTX_VSR_MIN_EDGE || height < RTX_VSR_MIN_EDGE) {
    throw new Error(
      `The upscaled output would be ${width}x${height}px, but every RTX VSR output edge must be at least ${RTX_VSR_MIN_EDGE}px. Choose a larger scale or target.`
    );
  }
  return { width, height };
}

// ============================================
// Main Workflow
// ============================================

async function main() {
  const OPTIONS = parseArgs();

  console.log('🖼️  Sogni Image Upscaling Workflow (RTX VSR, up to 16K)\n');

  // Load credentials
  const credentials = await loadCredentials();

  // Validate scale/target
  if (OPTIONS.scale !== null && !ALLOWED_SCALES.includes(OPTIONS.scale)) {
    console.error(`Error: --scale must be one of ${ALLOWED_SCALES.join(', ')} (use --target for an exact longest edge)`);
    process.exit(1);
  }
  if (OPTIONS.target !== null && (OPTIONS.target < RTX_VSR_MIN_EDGE || OPTIONS.target > RTX_VSR_MAX_EDGE)) {
    console.error(`Error: --target must be between ${RTX_VSR_MIN_EDGE} and ${RTX_VSR_MAX_EDGE}`);
    process.exit(1);
  }

  // Pick source image
  if (!OPTIONS.image && OPTIONS.interactive) {
    OPTIONS.image = await pickImageFile(null, 'image to upscale');
  }
  if (!OPTIONS.image) {
    console.error('Error: --image is required in non-interactive mode');
    process.exit(1);
  }
  if (!fs.existsSync(OPTIONS.image)) {
    console.error(`Error: Image '${OPTIONS.image}' does not exist`);
    process.exit(1);
  }

  // Read source dimensions and resolve the output size
  const sourceDimensions = imageSize(OPTIONS.image);
  if (!sourceDimensions.width || !sourceDimensions.height) {
    console.error('Error: Could not read source image dimensions');
    process.exit(1);
  }

  const sourceLongest = Math.max(sourceDimensions.width, sourceDimensions.height);
  const requestedScale =
    OPTIONS.target !== null
      ? OPTIONS.target / sourceLongest
      : OPTIONS.scale !== null
        ? OPTIONS.scale
        : RTX_VSR_MAX_EDGE / sourceLongest;

  let outputWidth, outputHeight;
  try {
    ({ width: outputWidth, height: outputHeight } = resolveUpscaleDimensions(sourceDimensions, requestedScale));
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }

  // Create output directory
  if (!fs.existsSync(OPTIONS.output)) {
    fs.mkdirSync(OPTIONS.output, { recursive: true });
  }

  try {
    // Connect and authenticate
    log('🔓', credentials.apiKey ? 'Authenticating with API key...' : 'Logging in...');
    const sogni = await createSogniConnection(credentials);
    log('✓', 'Connected to Sogni network');
    console.log();

    // Verify the model is available
    const models = sogni.projects.availableModels;
    const upscaleModel = models.find((m) => m.id === RTX_VSR_MODEL_ID);
    if (!upscaleModel) {
      throw new Error(`Model ${RTX_VSR_MODEL_ID} is not available on the network right now`);
    }
    log('✓', `Model ready: ${upscaleModel.name}`);
    console.log();

    // Get balance for token selection
    const balance = await sogni.account.refreshBalance();

    // Check for token type preference
    let tokenType = loadTokenTypePreference();

    if (!tokenType && OPTIONS.interactive) {
      console.log('💳 Select payment token type:\n');
      if (balance) {
        const sparkBalance = parseFloat(balance.spark.net || 0).toFixed(2);
        const sogniBalance = parseFloat(balance.sogni.net || 0).toFixed(2);
        console.log(`  1. Spark Points (Balance: ${sparkBalance})`);
        console.log(`  2. Sogni Tokens (Balance: ${sogniBalance})`);
      } else {
        console.log('  1. Spark Points');
        console.log('  2. Sogni Tokens');
      }
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
    } else if (!tokenType) {
      tokenType = 'spark';
    } else {
      console.log(`💳 Using saved payment preference: ${tokenType.charAt(0).toUpperCase() + tokenType.slice(1)} tokens`);
      console.log();
    }

    // Show configuration
    displayConfig('Upscale Configuration', {
      'Model': upscaleModel.name,
      'Source': OPTIONS.image,
      'Source size': `${sourceDimensions.width} x ${sourceDimensions.height}`,
      'Output size': `${outputWidth} x ${outputHeight}`,
      'Effective scale': `${(outputWidth / sourceDimensions.width).toFixed(2)}x`,
      'Billing': billingModeLabel(OPTIONS.billingMode)
    });

    // Get cost estimate
    log('💵', 'Fetching cost estimate...');
    const estimate = await getUpscaleJobEstimate(tokenType, outputWidth, outputHeight);

    console.log();
    console.log('📊 Cost Estimate:');
    if (tokenType === 'spark') {
      const cost = parseFloat(estimate.quote.project.costInSpark || 0);
      console.log(`   Spark: ${cost.toFixed(2)}`);
      if (balance && shouldCheckTokenBalance(OPTIONS.billingMode)) {
        const currentBalance = parseFloat(balance.spark.net || 0);
        console.log(`   Balance remaining: ${(currentBalance - cost).toFixed(2)} Spark`);
      }
      console.log(`   USD: $${(cost * 0.005).toFixed(4)}`);
    } else {
      const cost = parseFloat(estimate.quote.project.costInSogni || 0);
      console.log(`   Sogni: ${cost.toFixed(2)}`);
      if (balance && shouldCheckTokenBalance(OPTIONS.billingMode)) {
        const currentBalance = parseFloat(balance.sogni.net || 0);
        console.log(`   Balance remaining: ${(currentBalance - cost).toFixed(2)} Sogni`);
      }
      console.log(`   USD: $${(cost * 0.05).toFixed(4)}`);
    }

    console.log();
    if (OPTIONS.interactive) {
      const proceed = await askQuestion('Proceed with upscale? [Y/n]: ');
      if (proceed.toLowerCase() === 'n' || proceed.toLowerCase() === 'no') {
        log('❌', 'Upscale cancelled');
        process.exit(0);
      }
    } else {
      console.log('✓ Proceeding with upscale (non-interactive mode)');
    }

    // Create project
    log('📤', 'Submitting upscale job...');
    console.log();

    const startTime = Date.now();

    // CRITICAL: SDK requires Uint8Array/File/Blob objects for media uploads, NOT string paths.
    // RTX VSR is deterministic; steps are fixed by the model recipe and
    // guidance is omitted because the model does not support it.
    const project = await sogni.projects.create({
      type: 'image',
      modelId: RTX_VSR_MODEL_ID,
      positivePrompt: '',
      negativePrompt: '',
      stylePrompt: '',
      numberOfMedia: 1,
      steps: 1,
      startingImage: readFileAsBuffer(OPTIONS.image),
      startingImageStrength: 1,
      numberOfPreviews: 0,
      tokenType: tokenType,
      billingMode: OPTIONS.billingMode,
      sizePreset: 'custom',
      width: outputWidth,
      height: outputHeight,
      outputFormat: 'png'
    });

    // Track progress and completion
    let finished = false;
    let exitCode = 0;
    let lastETA;
    let progressLineActive = false;

    const clearProgress = () => {
      if (progressLineActive) {
        process.stdout.write('\r' + ' '.repeat(60) + '\r');
        progressLineActive = false;
      }
    };

    const formatETA = (seconds) => {
      if (seconds === undefined || seconds === null || seconds < 0) return '';
      if (seconds < 60) return `${Math.round(seconds)}s`;
      const mins = Math.floor(seconds / 60);
      const secs = Math.round(seconds % 60);
      return `${mins}m ${secs}s`;
    };

    const eventHandler = (event) => {
      switch (event.type) {
        case 'queued':
          clearProgress();
          log('📋', `Job queued at position: ${event.queuePosition || 'unknown'}`);
          break;

        case 'initiating':
          clearProgress();
          log('🔧', `Worker ${event.workerName || 'unknown'} initializing model...`);
          break;

        case 'started':
          clearProgress();
          log('🚀', `Worker ${event.workerName || 'unknown'} started upscaling`);
          break;

        case 'jobETA':
          lastETA = event.etaSeconds;
          if (lastETA > 0) {
            process.stdout.write(`\r⏳ Upscaling... ETA: ${formatETA(lastETA)}   `);
            progressLineActive = true;
          }
          break;

        case 'completed': {
          // Skip project-level completed events (only process job-level completions)
          if (!event.jobId) return;
          clearProgress();

          if (!event.resultUrl || event.error) {
            log('❌', `Job completed with error: ${event.error || 'No result URL'}`);
            finished = true;
            exitCode = 1;
            return;
          }

          const elapsedSeconds = (Date.now() - startTime) / 1000;
          const desiredPath = generateImageFilename({
            modelId: RTX_VSR_MODEL_ID,
            width: outputWidth,
            height: outputHeight,
            seed: event.seed ?? 0,
            prompt: 'upscale',
            generationTime: elapsedSeconds,
            outputFormat: 'png',
            outputDir: OPTIONS.output
          });
          const outputPath = getUniqueFilename(desiredPath);

          downloadImage(event.resultUrl, outputPath)
            .then(() => {
              log('✓', `Upscale completed in ${elapsedSeconds.toFixed(2)}s`);
              log('💾', `Saved: ${outputPath}`);
              openImage(outputPath);
              log('🎉', `Image upscaled to ${outputWidth} x ${outputHeight}!`);
              finished = true;
            })
            .catch((error) => {
              log('❌', `Download failed: ${error.message}`);
              finished = true;
              exitCode = 1;
            });
          break;
        }

        case 'error':
        case 'failed': {
          clearProgress();
          const errorMsg = event.error?.message || event.error || 'Unknown error';
          log('❌', `Job failed: ${errorMsg}`);
          finished = true;
          exitCode = 1;
          break;
        }
      }
    };

    sogni.projects.on('project', (event) => {
      if (event.projectId === project.id) {
        eventHandler(event);
      }
    });

    sogni.projects.on('job', (event) => {
      if (event.projectId === project.id) {
        eventHandler(event);
      }
    });

    // Wait for completion - SDK and server handle their own timeouts
    await new Promise((resolve) => {
      const checkCompletion = () => {
        if (finished) {
          resolve();
        } else {
          setTimeout(checkCompletion, 1000);
        }
      };
      checkCompletion();
    });

    console.log();
    process.exit(exitCode);
  } catch (error) {
    log('❌', `Error: ${error.message}`);
    process.exit(1);
  }
}

async function getUpscaleJobEstimate(tokenType, width, height) {
  const network = 'fast';
  const imageCount = 1;
  const stepCount = 1;
  const previewCount = 0;
  const cnEnabled = false;
  const denoiseStrength = 1.0;
  const guidance = 0;
  const scheduler = 'euler';
  const contextCount = 0;

  let baseUrl = process.env.SOGNI_SOCKET_ENDPOINT || 'https://socket.sogni.ai';
  if (baseUrl.startsWith('wss://')) {
    baseUrl = baseUrl.replace('wss://', 'https://');
  } else if (baseUrl.startsWith('ws://')) {
    baseUrl = baseUrl.replace('ws://', 'https://');
  }

  const url = `${baseUrl}/api/v3/job/estimate/${tokenType}/${network}/${encodeURIComponent(RTX_VSR_MODEL_ID)}/${imageCount}/${stepCount}/${previewCount}/${cnEnabled}/${denoiseStrength}/${width}/${height}/${guidance}/${scheduler}/${contextCount}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to get cost estimate: ${response.statusText}`);
  }
  return response.json();
}

async function downloadImage(url, outputPath) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.statusText}`);
  }

  const fileStream = fs.createWriteStream(outputPath);
  await streamPipeline(response.body, fileStream);
}

function openImage(imagePath) {
  const { platform } = process;
  let command;

  if (platform === 'darwin') {
    command = `open "${imagePath}"`;
  } else if (platform === 'win32') {
    command = `start "" "${imagePath}"`;
  } else {
    command = `xdg-open "${imagePath}"`;
  }

  exec(command, (error) => {
    if (error) {
      log('⚠️', `Could not auto-open image: ${error.message}`);
    } else {
      log('🖼️', `Opened image in viewer: ${imagePath}`);
    }
  });
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
