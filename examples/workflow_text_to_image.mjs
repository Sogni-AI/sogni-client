#!/usr/bin/env node
/**
 * Text-to-Image Workflow
 *
 * This script generates images from text prompts using various AI models.
 * Supports both text-to-image generation and optional image-to-image refinement.
 *
 * Prerequisites:
 * - Set SOGNI_USERNAME and SOGNI_PASSWORD in .env file (or will prompt)
 * - You need access to the 'fast' network for image generation
 *
 * Usage:
 *   node workflow_text_to_image.mjs "A beautiful sunset over mountains"
 *   node workflow_text_to_image.mjs "A futuristic city" --model flux2 --width 1024 --height 768
 *   node workflow_text_to_image.mjs "A beautiful sunset" --model flux2 --negative "blurry, low quality"
 *   node workflow_text_to_image.mjs "Abstract art" --model z-turbo --batch 3
 *   node workflow_text_to_image.mjs "Portrait" --seed 12345
 *
 * Options:
 *   --model     Model: flux2 or z-turbo (default: prompts for selection)
 *   --width     Image width (default: model-specific, multiple of 16)
 *   --height    Image height (default: model-specific, multiple of 16)
 *   --batch     Number of images to generate (default: 1)
 *   --guidance  Guidance scale for Flux2 (default: 4.0, range: 1.0-10.0)
 *   --steps     Inference steps (default: model-specific)
 *   --seed      Random seed for reproducibility (default: random)
 *   --output    Output directory (default: ./images)
 *   --disable-safe-content-filter  Disable NSFW/safety content filter (default: filter enabled)
 *   --help      Show this help message
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
  flux2: {
    id: 'flux2_dev_fp8',
    name: 'Flux2 Dev FP8',
    defaultWidth: 1248,
    defaultHeight: 832,
    minSteps: 10,
    maxSteps: 50,
    defaultSteps: 20,
    supportsGuidance: true,
    defaultGuidance: 4.0
  },
  'z-turbo': {
    id: 'z_image_turbo_bf16',
    name: 'Z Image Turbo BF16',
    defaultWidth: 1024,
    defaultHeight: 1024,
    minSteps: 4,
    maxSteps: 20,
    defaultSteps: 9,
    supportsGuidance: false,
    supportsDenoise: true,
    defaultDenoise: 0.7
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
    model: 'z-turbo', // Default to z-turbo
    width: null,
    height: null,
    batch: 1,
    guidance: null,
    steps: null,
    seed: null,
    output: './images',
    interactive: true,
    disableSafeContentFilter: false // Safe content filter enabled by default
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      showHelp();
      process.exit(0);
    } else if (arg === '--no-interactive') {
      options.interactive = false;
    } else if (arg === '--model' && args[i + 1]) {
      options.model = args[++i];
    } else if (arg === '--width' && args[i + 1]) {
      options.width = parseInt(args[++i], 10);
    } else if (arg === '--height' && args[i + 1]) {
      options.height = parseInt(args[++i], 10);
    } else if (arg === '--batch' && args[i + 1]) {
      options.batch = parseInt(args[++i], 10);
    } else if (arg === '--guidance' && args[i + 1]) {
      options.guidance = parseFloat(args[++i]);
    } else if (arg === '--steps' && args[i + 1]) {
      options.steps = parseInt(args[++i], 10);
    } else if (arg === '--negative' && args[i + 1]) {
      options.negative = args[++i];
    } else if (arg === '--style' && args[i + 1]) {
      options.style = args[++i];
    } else if (arg === '--seed' && args[i + 1]) {
      options.seed = parseInt(args[++i], 10);
    } else if (arg === '--output' && args[i + 1]) {
      options.output = args[++i];
    } else if (arg === '--disable-safe-content-filter') {
      options.disableSafeContentFilter = true;
    } else if (!arg.startsWith('--') && !options.prompt) {
      options.prompt = arg;
    } else {
      console.error(`Unknown option: ${arg}`);
      showHelp();
      process.exit(1);
    }
  }

  // Provide defaults when interactive and no prompt provided
  if (!options.prompt && options.interactive) {
    console.log('\n🤖 Text-to-Image Workflow');
    console.log('========================\n');

    // Default prompt
    const defaultPrompt = 'A beautiful landscape with mountains and a lake at sunset';
    const promptInput = await askQuestion(`Enter your prompt (default: "${defaultPrompt}"): `);
    options.prompt = promptInput.trim() || defaultPrompt;

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

    // Model selection (already defaults to z-turbo)
    if (options.model === 'z-turbo') {
      const modelChoice = await askQuestion('Use Z Image Turbo (fast) or Flux2 (high quality)? [z/f] (default: z): ');
      if (modelChoice && modelChoice.toLowerCase().startsWith('f')) {
        options.model = 'flux2';
      }
    }

    // Batch count
    const batchInput = await askQuestion('Number of images to generate (default: 1): ');
    if (batchInput.trim()) {
      const batchNum = parseInt(batchInput.trim(), 10);
      if (batchNum > 0 && batchNum <= 10) {
        options.batch = batchNum;
      }
    }

    console.log('\n✅ Configuration complete!\n');
  } else if (!options.prompt) {
    console.error('Error: Prompt is required (use --help for options)');
    showHelp();
    process.exit(1);
  }

  return options;
}

function showHelp() {
  console.log(`
Text-to-Image Workflow

Usage:
  node workflow_text_to_image.mjs "your prompt here"
  node workflow_text_to_image.mjs "A beautiful sunset" --model flux2 --negative "blurry, low quality"

Options:
  --model     Model: flux2 or z-turbo (default: z-turbo)
  --negative  Negative prompt (default: server default)
  --style     Style prompt (default: server default)
  --width     Image width (default: model-specific, multiple of 16)
  --height    Image height (default: model-specific, multiple of 16)
  --batch     Number of images to generate (default: 1)
  --guidance  Guidance scale for Flux2 (default: 4.0, range: 1.0-10.0)
  --steps     Inference steps (default: model-specific)
  --seed      Random seed for reproducibility (default: random)
  --output    Output directory (default: ./images)
  --disable-safe-content-filter  Disable NSFW/safety content filter (use with caution!)
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

async function selectModel() {
  console.log('\n🤖 Select AI Model:');
  console.log('  1. Flux2 Dev FP8 - High quality, slower generation');
  console.log('  2. Z Image Turbo BF16 - Fast generation, good quality');
  console.log();

  const choice = await askQuestion('Enter choice [1/2] (default: 1): ');
  const selected = choice.trim() || '1';

  if (selected === '1' || (selected && selected.toLowerCase() === 'flux2')) {
    return 'flux2';
  } else if (selected === '2' || (selected && selected.toLowerCase() === 'z-turbo')) {
    return 'z-turbo';
  } else {
    console.log('Invalid choice, using Flux2 Dev FP8');
    return 'flux2';
  }
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
  console.log('║               Text-to-Image Workflow                     ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log();

  // Load credentials
  const { username: USERNAME, password: PASSWORD } = await loadCredentials();

  // Determine model
  let selectedModel = OPTIONS.model;
  if (!selectedModel) {
    selectedModel = await selectModel();
  }

  const modelConfig = MODELS[selectedModel];
  if (!modelConfig) {
    console.error(`Error: Unknown model '${selectedModel}'`);
    process.exit(1);
  }

  log('🎨', `Selected model: ${modelConfig.name}`);

  // Set dimensions
  let width = OPTIONS.width || modelConfig.defaultWidth;
  let height = OPTIONS.height || modelConfig.defaultHeight;

  // Validate dimensions for Flux2 (must be multiple of 16)
  if (selectedModel === 'flux2') {
    if (width % 16 !== 0) {
      console.error(`Error: Width must be a multiple of 16 for Flux2 (got ${width})`);
      process.exit(1);
    }
    if (height % 16 !== 0) {
      console.error(`Error: Height must be a multiple of 16 for Flux2 (got ${height})`);
      process.exit(1);
    }
  }

  // Validate batch count
  if (OPTIONS.batch < 1 || OPTIONS.batch > 10) {
    console.error('Error: Batch count must be between 1 and 10');
    process.exit(1);
  }

  // Validate steps
  let steps = OPTIONS.steps || modelConfig.defaultSteps;
  if (steps < modelConfig.minSteps || steps > modelConfig.maxSteps) {
    console.error(`Error: Steps must be between ${modelConfig.minSteps} and ${modelConfig.maxSteps} for ${modelConfig.name}`);
    process.exit(1);
  }

  // Validate guidance for Flux2
  let guidance = OPTIONS.guidance;
  if (selectedModel === 'flux2') {
    guidance = guidance || modelConfig.defaultGuidance;
    if (guidance < 1.0 || guidance > 10.0) {
      console.error('Error: Guidance must be between 1.0 and 10.0 for Flux2');
      process.exit(1);
    }
  }



  // Create output directory
  if (!fs.existsSync(OPTIONS.output)) {
    fs.mkdirSync(OPTIONS.output, { recursive: true });
  }

  // Initialize client
  const clientConfig = {
    appId: `sogni-workflow-t2i-${Date.now()}`,
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
      const sparkBalance = parseFloat((balance.spark && balance.spark.net) || 0).toFixed(2);
      const sogniBalance = parseFloat((balance.sogni && balance.sogni.net) || 0).toFixed(2);

      console.log('💳 Select payment token type:\n');
      console.log(`  1. Spark Points (Balance: ${sparkBalance})`);
      console.log(`  2. Sogni Tokens (Balance: ${sogniBalance})`);
      console.log();

      const tokenChoice = await askQuestion('Enter choice [1/2] (default: 1): ');
      const choice = tokenChoice.trim() || '1';

      if (choice === '2' || (choice && choice.toLowerCase() === 'sogni')) {
        tokenType = 'sogni';
        console.log('  → Using Sogni tokens\n');
      } else {
        tokenType = 'spark';
        console.log('  → Using Spark tokens\n');
      }

      // Ask if they want to save the preference
      const savePreference = await askQuestion('Save payment preference to .env file? [Y/n]: ');
      if (savePreference && savePreference.toLowerCase() !== 'n' && savePreference.toLowerCase() !== 'no') {
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

    const estimate = await getImageJobEstimate(tokenType, modelConfig.id, steps, guidance, width, height);
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
      if (proceed && (proceed.toLowerCase() === 'n' || proceed.toLowerCase() === 'no')) {
        log('❌', 'Generation cancelled');
        return;
      }
    } else {
      console.log('✓ Proceeding with generation (non-interactive mode)');
    }

    // Calculate seed value for display
    const displaySeed = OPTIONS.seed !== null ? OPTIONS.seed : -1;

    // Show configuration
    console.log();
    console.log('┌─────────────────────────────────────────────────────────┐');
    console.log('│ Image Generation Configuration                          │');
    console.log('├─────────────────────────────────────────────────────────┤');

    const labelWidth = 12;
    const boxWidth = 58;

    console.log(`│ ${'Model:'.padEnd(labelWidth)}${modelConfig.name.padEnd(boxWidth - labelWidth - 2)} │`);
    console.log(`│ ${'Mode:'.padEnd(labelWidth)}${'Text-to-Image'.padEnd(boxWidth - labelWidth - 2)} │`);
    console.log(`│ ${'Resolution:'.padEnd(labelWidth)}${width + 'x' + String(height).padEnd(boxWidth - labelWidth - 2)} │`);
    console.log(`│ ${'Batch:'.padEnd(labelWidth)}${String(OPTIONS.batch).padEnd(boxWidth - labelWidth - 2)} │`);
    console.log(`│ ${'Steps:'.padEnd(labelWidth)}${String(steps).padEnd(boxWidth - labelWidth - 2)} │`);
    if (guidance !== undefined && guidance !== null) {
      console.log(`│ ${'Guidance:'.padEnd(labelWidth)}${String(guidance).padEnd(boxWidth - labelWidth - 2)} │`);
    }
    console.log(`│ ${'Seed:'.padEnd(labelWidth)}${String(displaySeed).padEnd(boxWidth - labelWidth - 2)} │`);
    const safetyStatus = OPTIONS.disableSafeContentFilter ? '⚠️  DISABLED' : 'enabled';
    console.log(`│ ${'Safety:'.padEnd(labelWidth)}${safetyStatus.padEnd(boxWidth - labelWidth - 2)} │`);
    console.log('└─────────────────────────────────────────────────────────┘');
    console.log();
    console.log('📝 Prompts:');
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
    const workflowType = 'Text-to-Image';
    log('📤', `Submitting ${workflowType.toLowerCase()} job...`);
    log('🎨', 'Generating images...');
    console.log();

    let startTime = Date.now();
    const projectParams = {
      type: 'image',
      modelId: modelConfig.id,
      positivePrompt: OPTIONS.prompt,
      numberOfMedia: OPTIONS.batch,
      steps: steps,
      seed: OPTIONS.seed !== null ? OPTIONS.seed : -1, // -1 for random seed
      numberOfPreviews: 5,
      disableNSFWFilter: OPTIONS.disableSafeContentFilter,
      outputFormat: 'jpg',
      tokenType: tokenType
    };

    // Add optional prompts if provided
    if (OPTIONS.negative) {
      projectParams.negativePrompt = OPTIONS.negative;
    }
    if (OPTIONS.style) {
      projectParams.stylePrompt = OPTIONS.style;
    }

    // Add model-specific parameters
    if (selectedModel === 'flux2' && guidance !== undefined) {
      projectParams.guidance = guidance;
    }

    // Set custom dimensions for all models to ensure consistency
    projectParams.width = width;
    projectParams.height = height;

    // Set up event handlers BEFORE creating project (following event_driven.js pattern)
    let completedImages = 0;
    let failedImages = 0;
    const totalImages = OPTIONS.batch;
    let projectFailed = false;
    let currentJobId = null; // Store the jobId from events
    let loggedStarted = false; // Avoid duplicate logging

    const eventHandler = (event) => {
      switch (event.type) {
        case 'initiating':
          log('⚙️', `Model initiating on worker: ${event.workerName || 'Unknown'}`);
          break;

        case 'started':
          log('🚀', `Job started on worker: ${event.workerName || 'Unknown'}`);
          break;

        case 'completed':
            // Ignore PROJECT 'completed' events - only process JOB 'completed' events
            // PROJECT events don't have jobId or resultUrl
            if (!event.jobId) {
              return;
            }
            // Check if NSFW filter was triggered
            if (event.isNSFW) {
              failedImages++;
              console.log('\n' + '─'.repeat(60));
              console.log('ℹ️  Safe Content Filter Triggered');
              console.log('─'.repeat(60));
              console.log('Your prompt or generated image was flagged by the content filter.');
              console.log('The image will not be available for download.\n');
              console.log('To disable the content filter, add this flag:');
              console.log(`  node workflow_text_to_image.mjs "${OPTIONS.prompt}" --disable-safe-content-filter\n`);
              console.log('Note: You have full control over content filtering.');
              console.log('─'.repeat(60) + '\n');
              checkWorkflowCompletion();
              return;
            }
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
            // Use model name and characteristics for better identification
            const imageNumber = completedImages + failedImages + 1;
            const modelShortName = selectedModel.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
            const seedStr = projectParams.seed !== -1 ? `_seed${projectParams.seed}` : '';
            const outputPath = `${OPTIONS.output}/${modelShortName}_${width}x${height}_steps${steps}${seedStr}_${imageNumber}.jpg`;

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
                const failedImageId = event.jobId || currentJobId || `image_${Date.now()}`;
                log('❌', `Download failed for ${failedImageId}: ${error.message}`);

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

    const project = await sogni.projects.create(projectParams);

    // Listen for progress events on the project instance (like in promise_based.mjs)
    project.on('progress', (progress) => {
      if (progress.step !== undefined && progress.stepCount !== undefined) {
        const progressPercent = Math.round((progress.step / progress.stepCount) * 100);
        process.stdout.write(`\r⏳ Progress: ${progressPercent}%`);
      }
    });

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
          log('🎉', `All ${totalImages} image${totalImages > 1 ? 's' : ''} generated successfully!`);
          console.log();
          process.exit(0); // Exit successfully
        } else {
          log('❌', `${failedImages} out of ${totalImages} image${totalImages > 1 ? 's' : ''} failed to generate`);
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
        reject(new Error('Generation timed out after 30 minutes'));
      }, 30 * 60 * 1000);

      checkCompletion();
    });

    // Final status check - checkWorkflowCompletion() should have already handled this
    // but provide fallback just in case
    if (completedImages + failedImages < totalImages) {
      log('⚠️', 'Workflow timed out before all jobs completed');
      process.exit(1);
    }

  } catch (error) {
    log('❌', `Error: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Get image job cost estimate
 */
async function getImageJobEstimate(tokenType, modelId, steps, guidance = 0, width = 1024, height = 1024) {
  const network = 'fast';
  const imageCount = 1;
  const stepCount = steps;
  const previewCount = 0;
  const cnEnabled = false;
  const denoiseStrength = 1.0;
  const scheduler = 'euler';
  const contextCount = 0;

  // Use configured socket endpoint or default, convert wss to https for HTTP requests
  let baseUrl = process.env.SOGNI_SOCKET_ENDPOINT || 'https://socket.sogni.ai';
  if (baseUrl.startsWith('wss://')) {
    baseUrl = baseUrl.replace('wss://', 'https://');
  } else if (baseUrl.startsWith('ws://')) {
    baseUrl = baseUrl.replace('ws://', 'https://');
  }
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
