#!/usr/bin/env node
/**
 * Image Edit Workflow
 *
 * This script generates edited versions of input images using Qwen Image Edit models.
 * Supports both quality and speed variants with configurable parameters.
 *
 * Prerequisites:
 * - Set SOGNI_USERNAME and SOGNI_PASSWORD in .env file (or will prompt)
 * - You need access to the 'fast' network for image editing
 * - Place input images in the test-assets folder
 *
 * Usage:
 *   node workflow_image_edit.mjs "add a sunset background" --image input.jpg
 *   node workflow_image_edit.mjs "convert to watercolor style" --image photo.jpg --model quality
 *   node workflow_image_edit.mjs "make it night time" --image landscape.jpg --batch 3
 *   node workflow_image_edit.mjs "add sunglasses" --image portrait.jpg --seed 12345
 *
 * Options:
 *   --image        Input image path (required)
 *   --negative     Negative prompt (default: server default)
 *   --style        Style prompt (default: server default)
 *   --model        Model variant: quality or speed (default: quality)
 *   --batch        Number of edited images to generate (default: 1)
 *   --seed         Random seed for reproducibility (default: random)
 *   --output       Output directory (default: ./images)
 *   --no-interactive  Skip interactive prompts (default: interactive mode)
 *   --help         Show this help message
 */

import { SogniClient } from '../dist/index.js';
import * as fs from 'node:fs';
import { pipeline } from 'node:stream';
import { promisify } from 'node:util';
import { exec } from 'node:child_process';
import * as readline from 'node:readline';
import imageSize from 'image-size';
import { loadCredentials, loadTokenTypePreference, saveTokenTypePreference } from './credentials.mjs';

const streamPipeline = promisify(pipeline);

// Model configurations
const MODELS = {
  quality: {
    id: 'qwen_image_edit_2511_fp8',
    name: 'Qwen Image Edit 2511 FP8 (Quality)',
    description: 'High quality image editing with detailed results',
    defaultSteps: 20
  },
  speed: {
    id: 'qwen_image_edit_2511_fp8_lightning',
    name: 'Qwen Image Edit 2511 FP8 Lightning (Speed)',
    description: 'Fast image editing with good quality',
    defaultSteps: 4
  }
};

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
    model: 'quality', // Default to quality model for image editing
    batch: 1,
    seed: null,
    output: './images',
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
    } else if (arg === '--negative' && args[i + 1]) {
      options.negative = args[++i];
    } else if (arg === '--style' && args[i + 1]) {
      options.style = args[++i];
    } else if (arg === '--model' && args[i + 1]) {
      options.model = args[++i];
    } else if (arg === '--batch' && args[i + 1]) {
      options.batch = parseInt(args[++i], 10);
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

  return options;
}

function showHelp() {
  console.log(`
Image Edit Workflow

Usage:
  node workflow_image_edit.mjs "add a sunset background" --image input.jpg
  node workflow_image_edit.mjs "convert to watercolor style" --image photo.jpg --model quality

Options:
  --image        Input image path (required)
  --negative     Negative prompt (default: server default)
  --style        Style prompt (default: server default)
  --model        Model variant: quality or speed (default: quality)
  --batch        Number of edited images to generate (default: 1)
  --seed         Random seed for reproducibility (default: random)
  --output       Output directory (default: ./images)
  --no-interactive  Skip interactive prompts (default: interactive mode)
  --help         Show this help message
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

// ============================================
// Utility Functions
// ============================================

function log(icon, message) {
  console.log(`${icon} ${message}`);
}

// ============================================
// Main Logic
// ============================================

async function main() {
  const OPTIONS = await parseArgs();

  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║                 Image Edit Workflow                      ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log();

  // Load credentials
  const { username: USERNAME, password: PASSWORD } = await loadCredentials();

  // Validate model
  if (!MODELS[OPTIONS.model]) {
    console.error(`Error: Unknown model variant '${OPTIONS.model}'. Use 'quality' or 'speed'.`);
    process.exit(1);
  }

  const modelConfig = MODELS[OPTIONS.model];
  log('🎨', `Selected model: ${modelConfig.name}`);

  // Validate batch count
  if (OPTIONS.batch < 1 || OPTIONS.batch > 10) {
    console.error('Error: Batch count must be between 1 and 10');
    process.exit(1);
  }

  // Create output directory
  if (!fs.existsSync(OPTIONS.output)) {
    fs.mkdirSync(OPTIONS.output, { recursive: true });
  }

  // Initialize client
  const clientConfig = {
    appId: `sogni-workflow-image-edit-${Date.now()}`,
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

  // Provide defaults when interactive and missing required parameters
  if (OPTIONS.interactive && (!OPTIONS.prompt || !OPTIONS.image)) {
    console.log('\n🎨 Image Edit Workflow');
    console.log('=====================\n');

    // Required image input
    if (!OPTIONS.image) {
      const imageInput = await askQuestion('Enter input image path (required): ');
      if (imageInput.trim()) {
        OPTIONS.image = imageInput.trim();
        if (!fs.existsSync(OPTIONS.image)) {
          console.error(`Error: Image file '${OPTIONS.image}' does not exist`);
          process.exit(1);
        }
      } else {
        console.error('Error: Input image is required');
        process.exit(1);
      }
    }

    // Required prompt
    if (!OPTIONS.prompt) {
      const defaultPrompt = 'Enhance the image with better lighting and colors';
      const promptInput = await askQuestion(`Enter edit prompt (default: "${defaultPrompt}"): `);
      OPTIONS.prompt = promptInput.trim() || defaultPrompt;
    }

    // Optional negative prompt
    const negativeInput = await askQuestion('Enter negative prompt (optional, press Enter to skip): ');
    if (negativeInput.trim()) {
      OPTIONS.negative = negativeInput.trim();
    }

    // Optional style prompt
    const styleInput = await askQuestion('Enter style prompt (optional, press Enter to skip): ');
    if (styleInput.trim()) {
      OPTIONS.style = styleInput.trim();
    }

    // Model selection (already defaults to quality)
    if (OPTIONS.model === 'quality') {
      const modelChoice = await askQuestion('Use Quality (detailed) or Speed (fast)? [q/s] (default: q): ');
      if (modelChoice.toLowerCase().startsWith('s')) {
        OPTIONS.model = 'speed';
      }
    }

    // Batch count
    const batchInput = await askQuestion('Number of edited images to generate (default: 1): ');
    if (batchInput.trim()) {
      const batchNum = parseInt(batchInput.trim(), 10);
      if (batchNum > 0 && batchNum <= 10) {
        OPTIONS.batch = batchNum;
      }
    }

    console.log('\n✅ Configuration complete!\n');
  } else {
    if (!OPTIONS.prompt) {
      console.error('Error: Edit prompt is required (use --help for options)');
      showHelp();
      process.exit(1);
    }
    if (!OPTIONS.image) {
      console.error('Error: Input image is required (use --help for options)');
      showHelp();
      process.exit(1);
    }
  }

  // Validate input image
  if (!fs.existsSync(OPTIONS.image)) {
    console.error(`Error: Input image '${OPTIONS.image}' does not exist`);
    process.exit(1);
  }

  // Get image dimensions for cost estimation
  let imageDimensions = { width: 1024, height: 1024 };
  try {
    const dimensions = imageSize(OPTIONS.image);
    if (dimensions.width && dimensions.height) {
      imageDimensions = { width: dimensions.width, height: dimensions.height };
    }
  } catch (error) {
    // Use defaults if detection fails
  }

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
    const estimate = await getImageJobEstimate(tokenType, modelConfig.id, modelConfig.defaultSteps, OPTIONS.image);

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
      const proceed = await askQuestion('Proceed with editing? [Y/n]: ');
      if (proceed.toLowerCase() === 'n' || proceed.toLowerCase() === 'no') {
        log('❌', 'Edit cancelled');
        return;
      }
    } else {
      console.log('✓ Proceeding with editing (non-interactive mode)');
    }

    // Show configuration
    console.log();
    console.log('┌─────────────────────────────────────────────────────────┐');
    console.log('│ Image Edit Configuration                                 │');
    console.log('├─────────────────────────────────────────────────────────┤');

    const labelWidth = 12;
    const boxWidth = 58;

    console.log(`│ ${'Model:'.padEnd(labelWidth)}${modelConfig.name.padEnd(boxWidth - labelWidth - 2)} │`);
    console.log(`│ ${'Input:'.padEnd(labelWidth)}${OPTIONS.image.padEnd(boxWidth - labelWidth - 2)} │`);
    console.log(`│ ${'Batch:'.padEnd(labelWidth)}${String(OPTIONS.batch).padEnd(boxWidth - labelWidth - 2)} │`);
    if (OPTIONS.seed !== null) {
      console.log(`│ ${'Seed:'.padEnd(labelWidth)}${String(OPTIONS.seed).padEnd(boxWidth - labelWidth - 2)} │`);
    }
    console.log('└─────────────────────────────────────────────────────────┘');
    console.log();
    console.log('📝 Edit Prompts:');
    console.log(`   Positive: ${OPTIONS.prompt}`);
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
    const imageModel = models.find((m) => m.id === modelConfig.id);

    if (!imageModel) {
      throw new Error(`Model ${modelConfig.id} not available`);
    }

    log('✓', `Model ready: ${imageModel.name}`);
    console.log();

    // Create project
    log('📤', 'Submitting image edit job...');
    log('🎨', 'Editing image...');
    console.log();

    let startTime = Date.now();
    const projectParams = {
      type: 'image',
      modelId: modelConfig.id,
      positivePrompt: OPTIONS.prompt,
      numberOfMedia: OPTIONS.batch,
      steps: modelConfig.defaultSteps,
      seed: OPTIONS.seed,
      startingImage: OPTIONS.image,
      tokenType: tokenType
    };

    // Add optional prompts if provided
    if (OPTIONS.negative) {
      projectParams.negativePrompt = OPTIONS.negative;
    }
    if (OPTIONS.style) {
      projectParams.stylePrompt = OPTIONS.style;
    }

    const project = await sogni.projects.create(projectParams);

    // Listen for progress events on the project instance
    project.on('progress', (progress) => {
      if (progress.step !== undefined && progress.stepCount !== undefined) {
        const progressPercent = Math.round((progress.step / progress.stepCount) * 100);
        process.stdout.write(`\r⏳ Progress: ${progressPercent}%`);
      }
    });

    // Set up event handlers
    let completedImages = 0;
    let failedImages = 0;
    const totalImages = OPTIONS.batch;
    let projectFailed = false;

    const eventHandler = (event) => {
      switch (event.type) {
        case 'progress':
          // Progress is handled by project.on('progress') above
          break;

        case 'completed':
          // Check if this completion event indicates failure
          if (!event.resultUrl || event.error) {
            failedImages++;
            log('❌', `Job completed with error: ${event.error || 'No result URL'}`);
          } else {
            // If project has already failed, ignore successful completions
            if (projectFailed) {
              log('⚠️', `Ignoring completion event for already failed project`);
              return;
            }
            // Start download - defer success counting until download completes
            const imageId = event.jobId || `edited_${Date.now()}`;
            const outputPath = `${OPTIONS.output}/${imageId}.png`;

            downloadImage(event.resultUrl, outputPath)
              .then(() => {
                // Download succeeded - now count as completed
                completedImages++;
                const elapsed = Math.round((Date.now() - startTime) / 1000);
                log('✓', `Image ${completedImages}/${totalImages} completed (${elapsed}s)`);
                log('💾', `Saved: ${outputPath}`);
                openImage(outputPath);

                // Check if workflow is complete
                checkWorkflowCompletion();
              })
              .catch((error) => {
                // Download failed - count as failed
                failedImages++;
                log('❌', `Download failed for ${imageId}: ${error.message}`);

                // Check if workflow is complete
                checkWorkflowCompletion();
              });
          }

          // For immediately failed completions, check completion right away
          if (!event.resultUrl || event.error) {
            checkWorkflowCompletion();
          }
          break;

        case 'failed':
          projectFailed = true;
          failedImages++;
          log('❌', `Job failed: ${event.error || 'Unknown error'}`);

          checkWorkflowCompletion();
          break;
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

    // Helper function to check workflow completion
    function checkWorkflowCompletion() {
      if (completedImages + failedImages === totalImages) {
        if (failedImages === 0) {
          log('🎉', `All ${totalImages} edited image${totalImages > 1 ? 's' : ''} generated successfully!`);
          console.log();
          process.exit(0);
        } else {
          log('❌', `${failedImages} out of ${totalImages} edited image${totalImages > 1 ? 's' : ''} failed to generate`);
          console.log();
          process.exit(1);
        }
      }
    }

    // Wait for completion or project failure
    await new Promise((resolve, reject) => {
      const checkCompletion = () => {
        if (projectFailed || completedImages + failedImages >= totalImages) {
          resolve();
        } else {
          setTimeout(checkCompletion, 1000);
        }
      };

      // Timeout after 30 minutes
      const timeout = setTimeout(() => {
        reject(new Error('Editing timed out after 30 minutes'));
      }, 30 * 60 * 1000);

      checkCompletion();
    });

    // Final status check
    if (projectFailed || failedImages > 0) {
      const failureCount = projectFailed ? totalImages : failedImages;
      log('❌', `Edit workflow failed with ${failureCount} failed job${failureCount > 1 ? 's' : ''}`);
      process.exit(1);
    } else {
      log('✅', 'Edit workflow completed successfully!');
    }

  } catch (error) {
    log('❌', `Error: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Get image job cost estimate
 */
async function getImageJobEstimate(tokenType, modelId, steps, inputImagePath) {
  const network = 'fast';
  const imageCount = 1;
  const stepCount = steps;
  const previewCount = 0;
  const cnEnabled = false;
  const denoiseStrength = 1.0;

  // Detect dimensions from input image, fallback to defaults
  let width = 1024;
  let height = 1024;
  if (inputImagePath) {
    try {
      const dimensions = imageSize(inputImagePath);
      if (dimensions.width && dimensions.height) {
        width = dimensions.width;
        height = dimensions.height;
      }
    } catch (error) {
      // Use defaults if image dimension detection fails
    }
  }

  // Use configured socket endpoint or default, convert wss to https for HTTP requests
  let baseUrl = process.env.SOGNI_SOCKET_ENDPOINT || 'https://socket.sogni.ai';
  if (baseUrl.startsWith('wss://')) {
    baseUrl = baseUrl.replace('wss://', 'https://');
  } else if (baseUrl.startsWith('ws://')) {
    baseUrl = baseUrl.replace('ws://', 'https://');
  }
  const guidance = 0;
  const scheduler = 'euler';
  const contextCount = 0;
  const url = `${baseUrl}/api/v3/job/estimate/${tokenType}/${network}/${encodeURIComponent(modelId)}/${imageCount}/${stepCount}/${previewCount}/${cnEnabled}/${denoiseStrength}/${width}/${height}/${guidance}/${scheduler}/${contextCount}`;
  console.log(`🔗 Cost estimate URL: ${url}`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to get cost estimate: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Download image from URL
 */
async function downloadImage(url, outputPath) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.statusText}`);
  }

  const fileStream = fs.createWriteStream(outputPath);
  await streamPipeline(response.body, fileStream);
}

/**
 * Open image in default OS image viewer
 */
function openImage(imagePath) {
  const { platform } = process;
  let command;

  if (platform === 'darwin') { // macOS
    command = `open "${imagePath}"`;
  } else if (platform === 'win32') { // Windows
    command = `start "" "${imagePath}"`;
  } else { // Linux and others
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

// ============================================
// Run Main
// ============================================

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
