#!/usr/bin/env node
/**
 * Text-to-Image Workflow
 *
 * This script generates images from text prompts using various AI models.
 * Supports both fast and high-quality generation with configurable parameters.
 * Z-Image Turbo also supports img2img workflow with starting images.
 *
 * Prerequisites:
 * - Set SOGNI_USERNAME and SOGNI_PASSWORD in .env file (or will prompt)
 * - You need access to the 'fast' network for image generation
 *
 * Usage:
 *   node workflow_text_to_image.mjs                          # Interactive mode
 *   node workflow_text_to_image.mjs "A beautiful sunset"     # With prompt
 *   node workflow_text_to_image.mjs "Portrait" --seed 12345  # With specific seed
 *   node workflow_text_to_image.mjs "Fantasy art" --model z-turbo --starting-image ./test-assets/placeholder.jpg --strength 0.7
 *
 * Options:
 *   --model     Model: z-turbo, flux1-schnell, or flux2 (default: prompts for selection)
 *   --width     Image width (default: model-specific, max: 2048)
 *   --height    Image height (default: model-specific, max: 2048)
 *   --batch     Number of images to generate (default: 1)
 *   --guidance  Guidance scale for Flux2 (default: 4.0)
 *   --steps     Inference steps (default: model-specific)
 *   --seed      Random seed for reproducibility (default: -1 for random)
 *   --sampler   Sampler name (default: euler)
 *   --scheduler Scheduler name (default: simple)
 *   --negative  Negative prompt (default: none)
 *   --style     Style prompt (default: none)
 *   --starting-image  Starting image for img2img (Z-Image Turbo only, default: none)
 *   --strength  Starting image strength 0-1 (Z-Image Turbo only, default: 0.5, higher = more influence)
 *   --output    Output directory (default: ./output)
 *   --disable-safe-content-filter  Disable NSFW/safety filter
 *   --no-interactive  Skip interactive prompts
 *   --help      Show this help message
 */

import { SogniClient } from '../dist/index.js';
import * as fs from 'node:fs';
import { pipeline } from 'node:stream';
import { promisify } from 'node:util';
import { exec } from 'node:child_process';
import { loadCredentials, loadTokenTypePreference, saveTokenTypePreference } from './credentials.mjs';
import {
  MODELS,
  askQuestion,
  selectModel,
  promptCoreOptions,
  promptAdvancedOptions,
  pickImageFile,
  readFileAsBuffer,
  log,
  displayConfig,
  displayPrompts,
  getUniqueFilename,
  createSogniConnection,
  getDefaultSampler,
  getDefaultScheduler
} from './workflow-helpers.mjs';

const streamPipeline = promisify(pipeline);

// Default prompt for this workflow
const DEFAULT_PROMPT = 'A mixed-media scene combining realistic photography and hand-drawn illustration. A 2D chibi cute cat is suggested only by loose, broken ink strokes, standing quietly in real physical space. The character is not enclosed by a complete outline — the silhouette is fragmented, incomplete, and interrupted, with strokes that do not fully connect. There is no solid interior at all. The body is formed by scattered and chaotic circular sketch lines, short and long hatching marks, and scribbles, leaving large open gaps where the real background passes through uninterrupted. The character feels barely held together, as if it exists only as an idea drawn in the air. The strokes vary in pressure and density: some lines are darker, others faint or partially erased. Edges dissolve into fewer marks instead of closing into a contour. Chibi proportions: oversized head, small body, big cute eyes, thin paws — all implied, not fully drawn. The face is minimal: eyes closed or lowered, expression calm and introspective. The surrounding environment is fully realistic photography: a beach sand in focus, with a soft, blurred outdoor background and shallow depth of field. The character casts no shadow, has no volume, and does not interact with light like a physical object. Mood: quiet, fragile, melancholic — a drawing that almost disappears inside reality. Style fusion: • broken ink sketch • incomplete line art • scribbled silhouette • negative space dominance • drawing dissolving into';

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
    batch: 1,
    guidance: null,
    steps: null,
    seed: null,
    sampler: null,
    scheduler: null,
    startingImage: null,
    strength: null,
    output: './output',
    interactive: true,
    disableSafeContentFilter: false
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
    } else if (arg === '--sampler' && args[i + 1]) {
      options.sampler = args[++i];
    } else if (arg === '--scheduler' && args[i + 1]) {
      options.scheduler = args[++i];
    } else if (arg === '--starting-image' && args[i + 1]) {
      options.startingImage = args[++i];
    } else if (arg === '--strength' && args[i + 1]) {
      options.strength = parseFloat(args[++i]);
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

  return options;
}

function showHelp() {
  console.log(`
Text-to-Image Workflow

Usage:
  node workflow_text_to_image.mjs                          # Interactive mode
  node workflow_text_to_image.mjs "your prompt here"       # With prompt
  node workflow_text_to_image.mjs "Portrait" --model flux2 # With specific model
  node workflow_text_to_image.mjs "Fantasy art" --model z-turbo --starting-image ref.jpg --strength 0.7

Available Models:
  z-turbo       - Z-Image Turbo (fast generation, max: 2048x2048, supports img2img)
  flux1-schnell - Flux.1 Schnell (very fast, 1-5 steps)
  flux2         - Flux.2 Dev (highest quality, max: 2048x2048, supports up to 6 context images)

Options:
  --model     Model: z-turbo, flux1-schnell, or flux2 (default: prompts for selection)
  --negative  Negative prompt (default: none)
  --style     Style prompt (default: none)
  --width     Image width (default: model-specific, max: 2048)
  --height    Image height (default: model-specific, max: 2048)
  --batch     Number of images to generate (default: 1)
  --guidance  Guidance scale for Flux2 (default: 4.0)
  --steps     Inference steps (default: model-specific)
  --seed      Random seed (default: -1 for random)
  --sampler   Sampler name (default: euler)
  --scheduler Scheduler name (default: simple)
  --starting-image  Starting image for img2img (Z-Image Turbo only)
  --strength  Starting image strength 0-1 (Z-Image Turbo only, default: 0.5)
  --output    Output directory (default: ./output)
  --disable-safe-content-filter  Disable NSFW/safety filter
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
  console.log('║               Text-to-Image Workflow                     ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log();

  // Load credentials
  const { username: USERNAME, password: PASSWORD } = await loadCredentials();

  // Interactive mode: select model and options
  let modelConfig;
  if (OPTIONS.interactive && !OPTIONS.modelKey) {
    const selection = await selectModel(MODELS.image, 'z-turbo');
    OPTIONS.modelKey = selection.key;
    modelConfig = selection.config;
  } else {
    OPTIONS.modelKey = OPTIONS.modelKey || 'z-turbo';
    modelConfig = MODELS.image[OPTIONS.modelKey];
    if (!modelConfig) {
      console.error(`Error: Unknown model '${OPTIONS.modelKey}'. Use 'z-turbo', 'flux1-schnell', or 'flux2'.`);
      process.exit(1);
    }
  }

  log('🎨', `Selected model: ${modelConfig.name}`);

  // Create SDK connection early to fetch dynamic sampler/scheduler options
  let sogni = null;
  if (OPTIONS.interactive) {
    log('🔄', 'Connecting to fetch model options...');
    try {
      sogni = await createSogniConnection(USERNAME, PASSWORD);
      log('✓', 'Connected');
    } catch (e) {
      log('⚠️', `Could not connect for dynamic options: ${e.message}`);
      log('ℹ️', 'Using default sampler/scheduler options');
    }
  }

  // Interactive mode: prompt for core options
  if (OPTIONS.interactive) {
    await promptCoreOptions(OPTIONS, modelConfig, {
      defaultPrompt: DEFAULT_PROMPT,
      isVideo: false
    });

    // Ask about advanced options
    const advancedChoice = await askQuestion('\nCustomize advanced options? [y/N]: ');
    if (advancedChoice.toLowerCase() === 'y' || advancedChoice.toLowerCase() === 'yes') {
      await promptAdvancedOptions(OPTIONS, modelConfig, { isVideo: false, sogni });

      // Prompt for starting image (img2img) - only supported by Z-Image Turbo
      if (OPTIONS.modelKey === 'z-turbo') {
        const useStartingImage = await askQuestion('\nUse a starting image (img2img)? [y/N]: ');
        if (useStartingImage.toLowerCase() === 'y' || useStartingImage.toLowerCase() === 'yes') {
          OPTIONS.startingImage = await pickImageFile(OPTIONS.startingImage, 'starting image');

          // Prompt for strength
          const strengthInput = await askQuestion('Starting image strength (0.0-1.0, default: 0.5, higher = more influence): ');
          if (strengthInput.trim()) {
            const s = parseFloat(strengthInput.trim());
            if (!isNaN(s) && s >= 0 && s <= 1) {
              OPTIONS.strength = s;
            }
          }
          if (OPTIONS.strength === undefined || OPTIONS.strength === null) {
            OPTIONS.strength = 0.5;
          }
        }
      }
    }

    console.log('\n✅ Configuration complete!\n');
  }

  // Apply defaults for non-interactive mode
  if (!OPTIONS.prompt) OPTIONS.prompt = DEFAULT_PROMPT;
  if (!OPTIONS.width) OPTIONS.width = modelConfig.defaultWidth;
  if (!OPTIONS.height) OPTIONS.height = modelConfig.defaultHeight;
  if (!OPTIONS.outputFormat) OPTIONS.outputFormat = 'jpg'; // Default to JPG

  // Cap dimensions to model max if specified
  if (modelConfig.maxWidth && OPTIONS.width > modelConfig.maxWidth) {
    log('⚠️', `Width exceeds model maximum of ${modelConfig.maxWidth}, capping to ${modelConfig.maxWidth}`);
    OPTIONS.width = modelConfig.maxWidth;
  }
  if (modelConfig.maxHeight && OPTIONS.height > modelConfig.maxHeight) {
    log('⚠️', `Height exceeds model maximum of ${modelConfig.maxHeight}, capping to ${modelConfig.maxHeight}`);
    OPTIONS.height = modelConfig.maxHeight;
  }

  // Apply default sampler/scheduler - try to get from SDK if connected
  if (!OPTIONS.sampler) {
    if (sogni) {
      const dynamicDefault = await getDefaultSampler(sogni, modelConfig.id);
      if (dynamicDefault) {
        OPTIONS.sampler = dynamicDefault;
      }
    }
    // Fall back to modelConfig defaults
    if (!OPTIONS.sampler) {
      if (modelConfig.isComfyModel && modelConfig.defaultComfySampler) {
        OPTIONS.sampler = modelConfig.defaultComfySampler;
      } else if (!modelConfig.isComfyModel && modelConfig.defaultSampler) {
        OPTIONS.sampler = modelConfig.defaultSampler;
      }
    }
  }
  if (!OPTIONS.scheduler) {
    if (sogni) {
      const dynamicDefault = await getDefaultScheduler(sogni, modelConfig.id);
      if (dynamicDefault) {
        OPTIONS.scheduler = dynamicDefault;
      }
    }
    // Fall back to modelConfig defaults
    if (!OPTIONS.scheduler) {
      if (modelConfig.isComfyModel && modelConfig.defaultComfyScheduler) {
        OPTIONS.scheduler = modelConfig.defaultComfyScheduler;
      } else if (!modelConfig.isComfyModel && modelConfig.defaultScheduler) {
        OPTIONS.scheduler = modelConfig.defaultScheduler;
      }
    }
  }

  // Validate dimensions
  if (OPTIONS.width % 16 !== 0) {
    log('⚠️', `Width adjusted to multiple of 16: ${Math.floor(OPTIONS.width / 16) * 16}`);
    OPTIONS.width = Math.floor(OPTIONS.width / 16) * 16;
  }
  if (OPTIONS.height % 16 !== 0) {
    log('⚠️', `Height adjusted to multiple of 16: ${Math.floor(OPTIONS.height / 16) * 16}`);
    OPTIONS.height = Math.floor(OPTIONS.height / 16) * 16;
  }

  // Validate batch count
  if (OPTIONS.batch < 1 || OPTIONS.batch > 10) {
    console.error('Error: Batch count must be between 1 and 10');
    process.exit(1);
  }

  // Validate and set steps
  let steps = OPTIONS.steps || modelConfig.defaultSteps;
  if (steps < modelConfig.minSteps || steps > modelConfig.maxSteps) {
    console.error(`Error: Steps must be between ${modelConfig.minSteps} and ${modelConfig.maxSteps} for ${modelConfig.name}`);
    process.exit(1);
  }

  // Validate guidance for Flux2
  let guidance = OPTIONS.guidance;
  if (modelConfig.supportsGuidance) {
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

  // Initialize client - reuse early connection if available, otherwise create new one
  if (!sogni) {
    const clientConfig = {
      appId: `sogni-workflow-t2i-${Date.now()}`,
      network: 'fast'
    };

    // Load optional configuration from environment
    const testnet = process.env.SOGNI_TESTNET === 'true';
    const socketEndpoint = process.env.SOGNI_SOCKET_ENDPOINT;
    const restEndpoint = process.env.SOGNI_REST_ENDPOINT;

    if (testnet) {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    }

    if (testnet) clientConfig.testnet = testnet;
    if (socketEndpoint) clientConfig.socketEndpoint = socketEndpoint;
    if (restEndpoint) clientConfig.restEndpoint = restEndpoint;

    sogni = await SogniClient.createInstance(clientConfig);

    // Login
    log('🔓', 'Logging in...');
    await sogni.account.login(USERNAME, PASSWORD);
    log('✓', `Logged in as: ${USERNAME}`);
    console.log();
  } else {
    log('✓', `Using existing connection as: ${USERNAME}`);
    console.log();
  }

  try {

    // Get balance for token selection
    const balance = await sogni.account.refreshBalance();

    // Check for token type preference
    let tokenType = loadTokenTypePreference();

    if (!tokenType) {
      const sparkBalance = parseFloat((balance.spark && balance.spark.net) || 0).toFixed(2);
      const sogniBalance = parseFloat((balance.sogni && balance.sogni.net) || 0).toFixed(2);

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

      const savePreference = await askQuestion('Save payment preference to .env file? [Y/n]: ');
      if (savePreference && savePreference.toLowerCase() !== 'n' && savePreference.toLowerCase() !== 'no') {
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
    const steps = OPTIONS.steps || modelConfig.defaultSteps;
    const guidance = OPTIONS.guidance !== undefined ? OPTIONS.guidance : modelConfig.defaultGuidance;
    const displaySeed = OPTIONS.seed !== null ? OPTIONS.seed : -1;

    displayConfig('Image Generation Configuration', {
      'Model': modelConfig.name,
      'Prompt': OPTIONS.prompt,
      'Resolution': `${OPTIONS.width}x${OPTIONS.height}`,
      'Batch': OPTIONS.batch,
      'Steps': steps,
      ...(guidance !== undefined && guidance !== null && { 'Guidance': guidance }),
      'Seed': displaySeed,
      'Sampler': OPTIONS.sampler,
      'Scheduler': OPTIONS.scheduler,
      'Safety': OPTIONS.disableSafeContentFilter ? '⚠️  DISABLED' : 'enabled'
    });

    if (OPTIONS.negative) {
      console.log(`   Negative prompt: ${OPTIONS.negative}`);
    }
    if (OPTIONS.style) {
      console.log(`   Style prompt: ${OPTIONS.style}`);
    }

    // Get cost estimate
    log('💵', 'Fetching cost estimate...');
    const estimate = await getImageJobEstimate(tokenType, modelConfig.id, steps, guidance || 0, OPTIONS.width, OPTIONS.height, OPTIONS.batch);
    console.log();
    console.log('📊 Cost Estimate:');

    if (tokenType === 'spark') {
      const cost = parseFloat(estimate.quote.project.costInSpark || 0);
      const currentBalance = parseFloat(balance.spark.net || 0);
      if (OPTIONS.batch > 1) {
        const costPerImage = cost / OPTIONS.batch;
        console.log(`   Per image: ${costPerImage.toFixed(2)} Spark`);
        console.log(`   Total (${OPTIONS.batch} images): ${cost.toFixed(2)} Spark`);
      } else {
        console.log(`   Spark: ${cost.toFixed(2)}`);
      }
      console.log(`   Balance remaining: ${(currentBalance - cost).toFixed(2)} Spark`);
      console.log(`   USD: $${(cost * 0.005).toFixed(4)}`);
    } else {
      const cost = parseFloat(estimate.quote.project.costInSogni || 0);
      const currentBalance = parseFloat(balance.sogni.net || 0);
      if (OPTIONS.batch > 1) {
        const costPerImage = cost / OPTIONS.batch;
        console.log(`   Per image: ${costPerImage.toFixed(2)} Sogni`);
        console.log(`   Total (${OPTIONS.batch} images): ${cost.toFixed(2)} Sogni`);
      } else {
        console.log(`   Sogni: ${cost.toFixed(2)}`);
      }
      console.log(`   Balance remaining: ${(currentBalance - cost).toFixed(2)} Sogni`);
      console.log(`   USD: $${(cost * 0.05).toFixed(4)}`);
    }

    console.log();
    if (OPTIONS.interactive) {
      const proceed = await askQuestion('Proceed with generation? [Y/n]: ');
      if (proceed && (proceed.toLowerCase() === 'n' || proceed.toLowerCase() === 'no')) {
        log('❌', 'Generation cancelled');
        process.exit(0);
      }
    } else {
      console.log('✓ Proceeding with generation (non-interactive mode)');
    }

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
    log('📤', 'Submitting text-to-image job...');
    log('🎨', 'Generating images...');
    console.log();

    let startTime = Date.now();
    const projectParams = {
      type: 'image',
      modelId: modelConfig.id,
      positivePrompt: OPTIONS.prompt,
      numberOfMedia: OPTIONS.batch,
      steps: steps,
      seed: OPTIONS.seed !== null ? OPTIONS.seed : -1,
      numberOfPreviews: 5,
      disableNSFWFilter: OPTIONS.disableSafeContentFilter,
      outputFormat: OPTIONS.outputFormat,
      tokenType: tokenType,
      width: OPTIONS.width,
      height: OPTIONS.height
    };

    // Add optional prompts
    if (OPTIONS.negative) {
      projectParams.negativePrompt = OPTIONS.negative;
    }
    if (OPTIONS.style) {
      projectParams.stylePrompt = OPTIONS.style;
    }

    // Add model-specific parameters
    if (modelConfig.supportsGuidance && guidance !== undefined) {
      projectParams.guidance = guidance;
    }

    // Add sampler/scheduler - use model defaults if not specified
    if (OPTIONS.sampler) {
      projectParams.sampler = OPTIONS.sampler;
    } else if (modelConfig.isComfyModel && modelConfig.defaultComfySampler) {
      projectParams.sampler = modelConfig.defaultComfySampler;
    } else if (!modelConfig.isComfyModel && modelConfig.defaultSampler) {
      projectParams.sampler = modelConfig.defaultSampler;
    }

    if (OPTIONS.scheduler) {
      projectParams.scheduler = OPTIONS.scheduler;
    } else if (modelConfig.isComfyModel && modelConfig.defaultComfyScheduler) {
      projectParams.scheduler = modelConfig.defaultComfyScheduler;
    } else if (!modelConfig.isComfyModel && modelConfig.defaultScheduler) {
      projectParams.scheduler = modelConfig.defaultScheduler;
    }

    // Add starting image and strength for img2img (only supported by Z-Image Turbo)
    if (OPTIONS.startingImage && OPTIONS.modelKey === 'z-turbo') {
      if (fs.existsSync(OPTIONS.startingImage)) {
        projectParams.startingImage = readFileAsBuffer(OPTIONS.startingImage);
        projectParams.startingImageStrength = OPTIONS.strength !== undefined && OPTIONS.strength !== null ? OPTIONS.strength : 0.5;
        log('🖼️', `Using starting image: ${OPTIONS.startingImage} (strength: ${projectParams.startingImageStrength})`);
      } else {
        log('⚠️', `Starting image not found: ${OPTIONS.startingImage}, proceeding without it`);
      }
    } else if (OPTIONS.startingImage && OPTIONS.modelKey !== 'z-turbo') {
      log('⚠️', `Starting image is only supported by Z-Image Turbo model, ignoring for ${modelConfig.name}`);
    }

    // Set up event handlers BEFORE creating project
    let completedImages = 0;
    let failedImages = 0;
    const totalImages = OPTIONS.batch;
    let projectFailed = false;
    let currentJobId = null;
    let lastETA = undefined;
    let lastETAUpdate = Date.now();
    let currentStep = undefined;
    let totalSteps = undefined;
    let etaCountdownInterval = null;

    // Format duration in human-readable form
    const formatETA = (seconds) => {
      if (seconds === undefined || seconds === null || seconds < 0) return '';
      if (seconds < 60) return `${Math.round(seconds)}s`;
      const mins = Math.floor(seconds / 60);
      const secs = Math.round(seconds % 60);
      return `${mins}m ${secs}s`;
    };

    // Update progress display with countdown
    const updateProgressDisplay = () => {
      if (currentStep !== undefined && totalSteps !== undefined) {
        const percent = Math.round((currentStep / totalSteps) * 100);
        let progressStr = `\r⏳ Step ${currentStep}/${totalSteps} (${percent}%)`;
        if (lastETA !== undefined) {
          // Calculate adjusted ETA based on time elapsed since last update
          const elapsedSinceUpdate = (Date.now() - lastETAUpdate) / 1000;
          const adjustedETA = Math.max(1, lastETA - elapsedSinceUpdate);
          progressStr += ` ETA: ${formatETA(adjustedETA)}`;
        }
        process.stdout.write(progressStr + '   '); // Extra spaces to clear previous longer output
      }
    };

    const eventHandler = (event) => {
      switch (event.type) {
        case 'initiating':
          log('⚙️', `Model initiating on worker: ${event.workerName || 'Unknown'}`);
          break;

        case 'started':
          log('🚀', `Job started on worker: ${event.workerName || 'Unknown'}`);
          break;

        case 'jobETA':
          lastETA = event.etaSeconds;
          lastETAUpdate = Date.now();
          // Start countdown interval if not already running
          if (!etaCountdownInterval && lastETA > 0) {
            etaCountdownInterval = setInterval(updateProgressDisplay, 1000);
          }
          break;

        case 'completed':
          if (!event.jobId) return;
          if (event.isNSFW) {
            failedImages++;
            console.log('\n' + '─'.repeat(60));
            console.log('ℹ️  Safe Content Filter Triggered');
            console.log('─'.repeat(60));
            console.log('Your prompt or generated image was flagged by the content filter.');
            console.log('To disable, add: --disable-safe-content-filter');
            console.log('─'.repeat(60) + '\n');
            checkWorkflowCompletion();
            return;
          }
          if (!event.resultUrl || event.error) {
            failedImages++;
            log('❌', `Job completed with error: ${event.error || 'No result URL'}`);
          } else {
            if (projectFailed) {
              log('⚠️', 'Ignoring completion event for already failed project');
              return;
            }

            const imageNumber = completedImages + failedImages + 1;
            const modelShortName = OPTIONS.modelKey.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
            const seedStr = projectParams.seed !== -1 ? `_seed${projectParams.seed}` : '';
            const extension = OPTIONS.outputFormat || 'jpg';
            const desiredPath = `${OPTIONS.output}/${modelShortName}_${OPTIONS.width}x${OPTIONS.height}_steps${steps}${seedStr}_${imageNumber}.${extension}`;
            const outputPath = getUniqueFilename(desiredPath);

            downloadImage(event.resultUrl, outputPath)
              .then(() => {
                completedImages++;
                const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
                log('✓', `Image ${completedImages}/${totalImages} completed (${elapsed}s)`);
                log('💾', `Saved: ${outputPath}`);
                openImage(outputPath);
                checkWorkflowCompletion();
              })
              .catch((error) => {
                failedImages++;
                const failedImageId = event.jobId || currentJobId || `image_${Date.now()}`;
                log('❌', `Download failed for ${failedImageId}: ${error.message}`);
                checkWorkflowCompletion();
              });
          }

          if (!event.resultUrl || event.error) {
            checkWorkflowCompletion();
          }
          break;

        case 'error':
        case 'failed':
          projectFailed = true;
          failedImages++;
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

    const project = await sogni.projects.create(projectParams);

    // Listen for project-level progress (0-100 percentage)
    project.on('progress', (progressPercent) => {
      // Skip 0% progress to avoid clutter before job starts
      if (progressPercent > 0) {
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
        // Handle step-level progress from job events
        if (event.type === 'progress' && event.step !== undefined && event.stepCount !== undefined) {
          currentStep = event.step;
          totalSteps = event.stepCount;
          updateProgressDisplay();
        }
        eventHandler(event);
      }
    });

    // Helper function to check workflow completion
    function checkWorkflowCompletion() {
      // Clear countdown interval when job completes
      if (etaCountdownInterval) {
        clearInterval(etaCountdownInterval);
        etaCountdownInterval = null;
      }
      if (completedImages + failedImages === totalImages) {
        if (failedImages === 0) {
          if (totalImages === 1) {
            log('🎉', 'Image generated successfully!');
          } else {
            log('🎉', `All ${totalImages} images generated successfully!`);
          }
          console.log();
          // Give a small delay for all image viewers to open
          process.exit(0);
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

      const timeout = setTimeout(() => {
        reject(new Error('Generation timed out after 30 minutes'));
      }, 30 * 60 * 1000);

      checkCompletion();
    });

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
async function getImageJobEstimate(tokenType, modelId, steps, guidance = 0, width = 1024, height = 1024, imageCount = 1) {
  const network = 'fast';
  const stepCount = steps;
  const previewCount = 0;
  const cnEnabled = false;
  const denoiseStrength = 1.0;
  const scheduler = 'euler';
  const contextCount = 0;

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

// ============================================
// Run Main
// ============================================

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
