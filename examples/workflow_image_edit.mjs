#!/usr/bin/env node
/**
 * Image Generation Workflow (with Reference Images)
 *
 * This script generates images using reference/context images to guide the generation.
 * Works with Qwen Image Edit and Flux models that support context-based generation.
 *
 * Prerequisites:
 * - Set SOGNI_API_KEY or SOGNI_USERNAME/SOGNI_PASSWORD in .env file (or will prompt)
 * - You need access to the 'fast' network for image generation
 *
 * Usage:
 *   node workflow_image_edit.mjs                                    # Interactive mode
 *   node workflow_image_edit.mjs "portrait in this style" --context ref.jpg
 *   node workflow_image_edit.mjs "modern artwork" --context ref1.jpg --context2 ref2.jpg
 *
 * Options:
 *   --context     Reference image 1 (required, at least 1 needed)
 *   --context2    Reference image 2 (optional)
 *   --context3    Reference image 3 (optional)
 *   --context4    Reference image 4 (optional, Flux2 only)
 *   --context5    Reference image 5 (optional, Flux2 only)
 *   --context6    Reference image 6 (optional, Flux2 only)
 *   --model       Model: qwen, qwen-lightning, or flux2 (default: prompts for selection)
 *   --width       Output image width (default: context image width, max: 2048)
 *   --height      Output image height (default: context image height, max: 2048)
 *   --batch       Number of images to generate (default: 1)
 *   --seed        Random seed for reproducibility (default: -1 for random)
 *   --guidance    Guidance scale for Flux2 (default: 4.0)
 *   --steps       Inference steps (default: model-specific)
 *   --sampler     Sampler name (default: euler)
 *   --scheduler   Scheduler name (default: simple)
 *   --negative    Negative prompt (default: none)
 *   --style       Style prompt (default: none)
 *   --output      Output directory (default: ./output)
 *   --disable-safe-content-filter  Disable NSFW/safety filter
 *   --no-interactive  Skip interactive prompts
 *   --help        Show this help message
 *
 * Note: For legacy compatibility, --image can be used and will be treated as --context
 */

import { SogniClient } from '../dist/index.js';
import * as fs from 'node:fs';
import { pipeline } from 'node:stream';
import { promisify } from 'node:util';
import { exec } from 'node:child_process';
import imageSize from 'image-size';
import { loadCredentials, loadTokenTypePreference, saveTokenTypePreference } from './credentials.mjs';
import {
  MODELS,
  askQuestion,
  selectModel,
  promptAdvancedOptions,
  promptBatchCount,
  promptContextImages,
  pickImageFile,
  readFilesAsBuffers,
  log,
  displayConfig,
  displayPrompts,
  getUniqueFilename,
  generateImageFilename,
  generateRandomSeed,
  defaultExamplesOutputDir,
  displaySafeContentFilterMessage,
  isSensitiveContentError
} from './workflow-helpers.mjs';

const streamPipeline = promisify(pipeline);

// Default prompt for this workflow
const DEFAULT_PROMPT = 'Generate an image in this style';

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
    contextImages: [],
    modelKey: null,
    batch: 1,
    seed: null,
    guidance: null,
    steps: null,
    sampler: null,
    scheduler: null,
    width: null,
    height: null,
    output: defaultExamplesOutputDir(),
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
    } else if (arg === '--image' && args[i + 1]) {
      options.image = args[++i];
    } else if (arg === '--context' && args[i + 1]) {
      options.contextImages[0] = args[++i];
    } else if (arg === '--context2' && args[i + 1]) {
      options.contextImages[1] = args[++i];
    } else if (arg === '--context3' && args[i + 1]) {
      options.contextImages[2] = args[++i];
    } else if (arg === '--context4' && args[i + 1]) {
      options.contextImages[3] = args[++i];
    } else if (arg === '--context5' && args[i + 1]) {
      options.contextImages[4] = args[++i];
    } else if (arg === '--context6' && args[i + 1]) {
      options.contextImages[5] = args[++i];
    } else if (arg === '--model' && args[i + 1]) {
      options.modelKey = args[++i];
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
    } else if (arg === '--steps' && args[i + 1]) {
      options.steps = parseInt(args[++i], 10);
    } else if (arg === '--sampler' && args[i + 1]) {
      options.sampler = args[++i];
    } else if (arg === '--scheduler' && args[i + 1]) {
      options.scheduler = args[++i];
    } else if (arg === '--width' && args[i + 1]) {
      options.width = parseInt(args[++i], 10);
    } else if (arg === '--height' && args[i + 1]) {
      options.height = parseInt(args[++i], 10);
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
Image Generation Workflow (with Reference Images)

This workflow generates new images using reference images to guide the style/content.
Works with Qwen Image Edit and Flux models that support context-based generation.

Usage:
  node workflow_image_edit.mjs                                    # Interactive mode
  node workflow_image_edit.mjs "portrait in this style" --context ref.jpg
  node workflow_image_edit.mjs "modern artwork" --context ref1.jpg --context2 ref2.jpg

Available Models:
  qwen-lightning - Qwen Image Edit 2511 Lightning (fast, 4-step, default)
  qwen           - Qwen Image Edit 2511 (high quality, 20-step)
  flux2          - Flux.2 Dev (high quality with up to 6 context images)

Options:
  --context     Reference image 1 (required, at least 1 needed)
  --context2    Reference image 2 (optional)
  --context3    Reference image 3 (optional)
  --context4    Reference image 4 (optional, Flux2 only)
  --context5    Reference image 5 (optional, Flux2 only)
  --context6    Reference image 6 (optional, Flux2 only)
  --model       Model: qwen, qwen-lightning, or flux2 (default: prompts for selection)
  --width       Output image width (default: context image width, max: 2048)
  --height      Output image height (default: context image height, max: 2048)
  --negative    Negative prompt (default: none)
  --style       Style prompt (default: none)
  --batch       Number of images to generate (default: 1)
  --seed        Random seed (default: -1 for random)
  --guidance    Guidance scale for Flux2 (default: 4.0)
  --steps       Inference steps (default: model-specific)
  --sampler     Sampler name (default: euler)
  --scheduler   Scheduler name (default: simple)
  --output      Output directory (default: ./output)
  --disable-safe-content-filter  Disable NSFW/safety filter
  --no-interactive  Skip interactive prompts
  --help        Show this help message

Reference Images:
  Qwen and Flux models use reference images to guide the generation (not img2img editing).
  Provide 1-6 reference images (Flux2) or 1-3 (Qwen) that represent the style or content you want.
  Example: portrait photo → generates new portraits in that style
`);
}

// ============================================
// Main Logic
// ============================================

async function main() {
  const OPTIONS = await parseArgs();

  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║           Image Generation (Reference-Based)             ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log();

  // Load credentials
  const credentials = await loadCredentials();

  // Legacy support: if --image was used, treat it as the first context image
  if (OPTIONS.image && !OPTIONS.contextImages[0]) {
    OPTIONS.contextImages[0] = OPTIONS.image;
  }

  // Get image dimensions for cost estimation (use first context image if available)
  let imageDimensions = { width: 1024, height: 1024 };
  const firstImage = OPTIONS.contextImages[0];
  if (firstImage) {
    try {
      const dimensions = imageSize(firstImage);
      if (dimensions.width && dimensions.height) {
        imageDimensions = { width: dimensions.width, height: dimensions.height };
      }
    } catch (error) {
      // Use defaults if detection fails
    }
  }

  // Interactive mode: select model and options
  let modelConfig;
  if (OPTIONS.interactive && !OPTIONS.modelKey) {
    const selection = await selectModel(MODELS.imageEdit, 'qwen-lightning');
    OPTIONS.modelKey = selection.key;
    modelConfig = selection.config;
  } else {
    OPTIONS.modelKey = OPTIONS.modelKey || 'qwen-lightning';
    modelConfig = MODELS.imageEdit[OPTIONS.modelKey];
    if (!modelConfig) {
      console.error(`Error: Unknown model '${OPTIONS.modelKey}'. Use 'qwen-lightning', 'qwen', or 'flux2'.`);
      process.exit(1);
    }
  }

  log('🎨', `Selected model: ${modelConfig.name}`);

  // Interactive mode: prompt for options
  if (OPTIONS.interactive) {
    // Prompt for context images (at least 1 required)
    if (OPTIONS.contextImages.length === 0) {
      console.log('\n💡 This workflow uses reference images to guide the generation.');
      console.log('   Provide 1-3 images that represent the style or content you want.');
      console.log('   Example: portrait photo → generated portrait in that style\n');

      // Get first context image (required)
      const firstContextImage = await pickImageFile(null, '1st reference image (required)');
      OPTIONS.contextImages.push(firstContextImage);
      log('✓', `Added reference image: ${firstContextImage}`);

      // Re-detect dimensions from the selected context image
      try {
        const dimensions = imageSize(firstContextImage);
        if (dimensions.width && dimensions.height) {
          imageDimensions = { width: dimensions.width, height: dimensions.height };
        }
      } catch (error) {
        // Keep existing dimensions if detection fails
      }
    }

    // Ask for additional context images
    const maxContextImages = modelConfig.maxContextImages || 3;
    console.log('\n📸 Additional Reference Images\n');
    console.log(`  You can add up to ${maxContextImages - 1} more reference images.`);
    console.log('  Enter the image number or 0 to skip.\n');

    for (let i = 1; i < maxContextImages; i++) {
      const ordinal = ['2nd', '3rd', '4th', '5th', '6th'][i - 1] || `${i + 1}th`;

      try {
        // Scan directories for image files
        const scanDirs = ['./test-assets', './images'];
        let allImages = [];

        for (const scanDir of scanDirs) {
          if (fs.existsSync(scanDir)) {
            const files = fs.readdirSync(scanDir)
              .filter((f) => /\.(jpg|jpeg|png|webp)$/i.test(f))
              .map((f) => ({ file: f, dir: scanDir, path: `${scanDir}/${f}` }));
            allImages = allImages.concat(files);
          }
        }

        if (allImages.length === 0) {
          log('⚠️', 'No image files found in test-assets or images directories.');
          break;
        }

        console.log(`  ${ordinal} reference image:\n`);
        console.log('    0. Skip (no additional image)');
        allImages.forEach((img, idx) => {
          console.log(`    ${idx + 1}. ${img.path}`);
        });
        console.log();

        const answer = await askQuestion(`  Enter choice [0-${allImages.length}] (0 to skip): `);
        const choice = parseInt(answer.trim(), 10);

        if (isNaN(choice) || choice === 0) {
          console.log('    → Skipping\n');
          break;
        } else if (choice >= 1 && choice <= allImages.length) {
          const selectedPath = allImages[choice - 1].path;
          OPTIONS.contextImages.push(selectedPath);
          log('✓', `Added reference image ${i + 1}: ${selectedPath}\n`);
        } else {
          console.log('    → Invalid choice, skipping\n');
          break;
        }
      } catch (error) {
        log('⚠️', `Could not add reference image: ${error.message}`);
        break;
      }
    }

    // Prompt for width and height (right after context images, not in advanced)
    console.log('📐 Output Dimensions\n');
    console.log(`  Context image size: ${imageDimensions.width} x ${imageDimensions.height}`);

    // Default to context image dimensions for all models
    const defaultWidth = imageDimensions.width;
    const widthInput = await askQuestion(`  Width (default: ${defaultWidth}): `);
    if (widthInput.trim()) {
      const w = parseInt(widthInput.trim(), 10);
      if (!isNaN(w) && w > 0) {
        OPTIONS.width = w;
      }
    }
    if (!OPTIONS.width) OPTIONS.width = defaultWidth;

    const defaultHeight = imageDimensions.height;
    const heightInput = await askQuestion(`  Height (default: ${defaultHeight}): `);
    if (heightInput.trim()) {
      const h = parseInt(heightInput.trim(), 10);
      if (!isNaN(h) && h > 0) {
        OPTIONS.height = h;
      }
    }
    if (!OPTIONS.height) OPTIONS.height = defaultHeight;

    // Prompt
    if (!OPTIONS.prompt) {
      console.log(`\nDefault prompt: "${DEFAULT_PROMPT}"`);
      const promptInput = await askQuestion('Enter your generation prompt (or press Enter for default): ');
      OPTIONS.prompt = promptInput.trim() || DEFAULT_PROMPT;
    }

    // Ask about advanced options
    const advancedChoice = await askQuestion('\nCustomize advanced options? [y/N]: ');
    if (advancedChoice.toLowerCase() === 'y' || advancedChoice.toLowerCase() === 'yes') {
      await promptAdvancedOptions(OPTIONS, modelConfig, { isVideo: false });
    }

    console.log('\n✅ Configuration complete!\n');
  }

  // Validate that at least 1 context image is provided
  if (OPTIONS.contextImages.length === 0) {
    console.error('Error: At least one reference image is required (use --context option)');
    process.exit(1);
  }

  // Re-detect image dimensions from first context image
  // (needed for interactive mode where images are selected after initial detection)
  const firstContextImage = OPTIONS.contextImages[0];
  if (firstContextImage) {
    try {
      const dimensions = imageSize(firstContextImage);
      if (dimensions.width && dimensions.height) {
        imageDimensions = { width: dimensions.width, height: dimensions.height };
      }
    } catch (error) {
      // Keep existing dimensions if detection fails
    }
  }

  // Apply defaults
  if (!OPTIONS.prompt) OPTIONS.prompt = DEFAULT_PROMPT;
  if (!OPTIONS.outputFormat) OPTIONS.outputFormat = 'jpg'; // Default to JPG

  // Apply default sampler/scheduler based on model type
  if (!OPTIONS.sampler) {
    if (modelConfig.isComfyModel && modelConfig.defaultComfySampler) {
      OPTIONS.sampler = modelConfig.defaultComfySampler;
    } else if (!modelConfig.isComfyModel && modelConfig.defaultSampler) {
      OPTIONS.sampler = modelConfig.defaultSampler;
    }
  }
  if (!OPTIONS.scheduler) {
    if (modelConfig.isComfyModel && modelConfig.defaultComfyScheduler) {
      OPTIONS.scheduler = modelConfig.defaultComfyScheduler;
    } else if (!modelConfig.isComfyModel && modelConfig.defaultScheduler) {
      OPTIONS.scheduler = modelConfig.defaultScheduler;
    }
  }

  // Validate batch count
  if (OPTIONS.batch < 1 || OPTIONS.batch > 512) {
    console.error('Error: Batch count must be between 1 and 512');
    process.exit(1);
  }

  // Validate context images
  for (let i = 0; i < OPTIONS.contextImages.length; i++) {
    const contextPath = OPTIONS.contextImages[i];
    if (contextPath && !fs.existsSync(contextPath)) {
      console.error(`Error: Context image ${i + 1} '${contextPath}' does not exist`);
      process.exit(1);
    }
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

  const testnet = process.env.SOGNI_TESTNET === 'true';
  const socketEndpoint = process.env.SOGNI_SOCKET_ENDPOINT;
  const restEndpoint = process.env.SOGNI_REST_ENDPOINT;

  if (testnet) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  }

  if (testnet) clientConfig.testnet = testnet;
  if (socketEndpoint) clientConfig.socketEndpoint = socketEndpoint;
  if (restEndpoint) clientConfig.restEndpoint = restEndpoint;

  if (credentials.apiKey) clientConfig.apiKey = credentials.apiKey;
  const sogni = await SogniClient.createInstance(clientConfig);

  try {
    // Login (skip for API key auth)
    if (!credentials.apiKey) {
      log('🔓', 'Logging in...');
      await sogni.account.login(credentials.username, credentials.password);
      log('✓', `Logged in as: ${credentials.username}`);
    } else {
      log('✓', 'Authenticated with API key');
    }
    console.log();

    // Get balance for token selection
    const balance = await sogni.account.refreshBalance();

    // Check for token type preference
    let tokenType = loadTokenTypePreference();

    if (!tokenType) {
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
    } else {
      console.log(`💳 Using saved payment preference: ${tokenType.charAt(0).toUpperCase() + tokenType.slice(1)} tokens`);
      console.log();
    }

    // Ask for batch count as last question before confirmation
    if (OPTIONS.interactive) {
      await promptBatchCount(OPTIONS, { isVideo: false });
    }

  // Determine output dimensions:
  // Default to context image dimensions for all models (user can customize)
  let outputWidth, outputHeight;
  if (OPTIONS.width && OPTIONS.height) {
    // User specified both dimensions
    outputWidth = OPTIONS.width;
    outputHeight = OPTIONS.height;
  } else {
    // Use context image dimensions as default for all models
    outputWidth = OPTIONS.width || imageDimensions.width;
    outputHeight = OPTIONS.height || imageDimensions.height;
  }

  // Cap dimensions to model max if specified
  if (modelConfig.maxWidth && outputWidth > modelConfig.maxWidth) {
    log('⚠️', `Width exceeds model maximum of ${modelConfig.maxWidth}, capping to ${modelConfig.maxWidth}`);
    outputWidth = modelConfig.maxWidth;
  }
  if (modelConfig.maxHeight && outputHeight > modelConfig.maxHeight) {
    log('⚠️', `Height exceeds model maximum of ${modelConfig.maxHeight}, capping to ${modelConfig.maxHeight}`);
    outputHeight = modelConfig.maxHeight;
  }

    // Show configuration first
    const steps = OPTIONS.steps || modelConfig.defaultSteps;
    const configDisplay = {
      'Model': modelConfig.name,
      'Prompt': OPTIONS.prompt,
      'Reference Images': OPTIONS.contextImages.length,
      'Dimensions': `${outputWidth} x ${outputHeight}`,
      'Batch': OPTIONS.batch,
      'Steps': steps,
      'Seed': OPTIONS.seed !== null ? OPTIONS.seed : -1,
      'Safety': OPTIONS.disableSafeContentFilter ? '⚠️  DISABLED' : 'enabled'
    };

    // Add reference images to display
    OPTIONS.contextImages.forEach((img, i) => {
      if (img) {
        configDisplay[`Reference ${i + 1}`] = img;
      }
    });

    displayConfig('Image Generation Configuration', configDisplay);

    if (OPTIONS.negative) {
      console.log(`   Negative prompt: ${OPTIONS.negative}`);
    }
    if (OPTIONS.style) {
      console.log(`   Style prompt: ${OPTIONS.style}`);
    }

    // Get cost estimate
    log('💵', 'Fetching cost estimate...');
    const estimate = await getImageJobEstimate(tokenType, modelConfig.id, steps, OPTIONS.contextImages[0], OPTIONS.batch);

    console.log();
    console.log('📊 Cost Estimate:');

    if (tokenType === 'spark') {
      const cost = parseFloat(estimate.quote.project.costInSpark || 0);
      if (OPTIONS.batch > 1) {
        const costPerImage = cost / OPTIONS.batch;
        console.log(`   Per image: ${costPerImage.toFixed(2)} Spark`);
        console.log(`   Total (${OPTIONS.batch} images): ${cost.toFixed(2)} Spark`);
      } else {
        console.log(`   Spark: ${cost.toFixed(2)}`);
      }
      if (balance) {
        const currentBalance = parseFloat(balance.spark.net || 0);
        console.log(`   Balance remaining: ${(currentBalance - cost).toFixed(2)} Spark`);
      }
      console.log(`   USD: $${(cost * 0.005).toFixed(4)}`);
    } else {
      const cost = parseFloat(estimate.quote.project.costInSogni || 0);
      if (OPTIONS.batch > 1) {
        const costPerImage = cost / OPTIONS.batch;
        console.log(`   Per image: ${costPerImage.toFixed(2)} Sogni`);
        console.log(`   Total (${OPTIONS.batch} images): ${cost.toFixed(2)} Sogni`);
      } else {
        console.log(`   Sogni: ${cost.toFixed(2)}`);
      }
      if (balance) {
        const currentBalance = parseFloat(balance.sogni.net || 0);
        console.log(`   Balance remaining: ${(currentBalance - cost).toFixed(2)} Sogni`);
      }
      console.log(`   USD: $${(cost * 0.05).toFixed(4)}`);
    }

    console.log();
    if (OPTIONS.interactive) {
      const proceed = await askQuestion('Proceed with generation? [Y/n]: ');
      if (proceed.toLowerCase() === 'n' || proceed.toLowerCase() === 'no') {
        log('❌', 'Edit cancelled');
        process.exit(0);
      }
    } else {
      console.log('✓ Proceeding with editing (non-interactive mode)');
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

    // Generate seed client-side if not specified (for reliable filename generation)
    if (OPTIONS.seed === null || OPTIONS.seed === -1) {
      OPTIONS.seed = generateRandomSeed();
      log('🎲', `Generated seed: ${OPTIONS.seed}`);
    }

    // Create project
    log('📤', 'Submitting image generation job...');
    log('🎨', 'Generating image from references...');
    console.log();

    let startTime = Date.now();

    // CRITICAL: SDK requires Uint8Array/File/Blob objects for media uploads, NOT string paths.
    // Passing string paths will silently fail (the string text gets uploaded instead of file contents).
    const contextImageBuffers = readFilesAsBuffers(OPTIONS.contextImages);

    const projectParams = {
      type: 'image',
      modelId: modelConfig.id,
      positivePrompt: OPTIONS.prompt,
      numberOfMedia: OPTIONS.batch,
      steps: steps,
      seed: OPTIONS.seed,
      contextImages: contextImageBuffers,
      tokenType: tokenType,
      sizePreset: 'custom',
      width: outputWidth,
      height: outputHeight,
      outputFormat: OPTIONS.outputFormat,
      disableNSFWFilter: OPTIONS.disableSafeContentFilter
    };

    // Add guidance for Flux2
    if (modelConfig.supportsGuidance) {
      projectParams.guidance = OPTIONS.guidance || modelConfig.defaultGuidance || 4.0;
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

    // Add optional prompts
    if (OPTIONS.negative) {
      projectParams.negativePrompt = OPTIONS.negative;
    }
    if (OPTIONS.style) {
      projectParams.stylePrompt = OPTIONS.style;
    }

    const project = await sogni.projects.create(projectParams);

    // Set up event handlers
    let completedImages = 0;
    let failedImages = 0;
    const totalImages = OPTIONS.batch;
    let projectFailed = false;
    let lastETA = undefined;
    let lastETAUpdate = Date.now();
    let currentStep = undefined;
    let totalSteps = undefined;
    let progressLineActive = false;
    let etaCountdownInterval = null;

    // Format duration in human-readable form
    const formatETA = (seconds) => {
      if (seconds === undefined || seconds === null || seconds < 0) return '';
      if (seconds < 60) return `${Math.round(seconds)}s`;
      const mins = Math.floor(seconds / 60);
      const secs = Math.round(seconds % 60);
      return `${mins}m ${secs}s`;
    };

    // Clear progress line before logging
    const clearProgress = () => {
      if (progressLineActive) {
        process.stdout.write('\r' + ' '.repeat(60) + '\r');
        progressLineActive = false;
      }
    };

    // Update progress display with countdown
    const updateProgressDisplay = () => {
      if (currentStep !== undefined && totalSteps !== undefined) {
        const percent = Math.round((currentStep / totalSteps) * 100);
        let progressStr = `\r⏳ Step ${currentStep}/${totalSteps} (${percent}%)`;
        if (lastETA !== undefined) {
          const elapsedSinceUpdate = (Date.now() - lastETAUpdate) / 1000;
          const adjustedETA = Math.max(1, lastETA - elapsedSinceUpdate);
          progressStr += ` ETA: ${formatETA(adjustedETA)}`;
        }
        process.stdout.write(progressStr + '   ');
        progressLineActive = true;
      }
    };

    // Listen for project-level progress (0-100 percentage)
    project.on('progress', (progressPercent) => {
      // Skip 0% progress to avoid clutter before job starts
      if (progressPercent > 0) {
        process.stdout.write(`\r⏳ Progress: ${progressPercent}%`);
        progressLineActive = true;
      }
    });

    const eventHandler = (event) => {
      // Handle step-level progress from job events
      if (event.type === 'progress' && event.step !== undefined && event.stepCount !== undefined) {
                currentStep = event.step;
        totalSteps = event.stepCount;
        updateProgressDisplay();
      }

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
          log('🚀', `Worker ${event.workerName || 'unknown'} started generation`);
          break;

        case 'jobETA':
                    lastETA = event.etaSeconds;
          lastETAUpdate = Date.now();
          if (!etaCountdownInterval && lastETA > 0) {
            etaCountdownInterval = setInterval(updateProgressDisplay, 1000);
          }
          break;

        case 'completed':
                    // Skip project-level completed events (only process job-level completions)
          if (!event.jobId) return;
          clearProgress();

          if (event.isNSFW && !OPTIONS.disableSafeContentFilter) {
            failedImages++;
            displaySafeContentFilterMessage({ showDisableHint: true });
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
            // Calculate elapsed time for this image
            const elapsedSeconds = (Date.now() - startTime) / 1000;

            // Use actual seed from job completion event (server generates unique seeds for batch items)
            const jobIndex = completedImages + failedImages;
            const jobSeed = event.seed ?? (OPTIONS.seed + jobIndex);

            const desiredPath = generateImageFilename({
              modelId: modelConfig.id,
              width: outputWidth,
              height: outputHeight,
              seed: jobSeed,
              prompt: OPTIONS.prompt,
              generationTime: elapsedSeconds,
              outputFormat: OPTIONS.outputFormat,
              outputDir: OPTIONS.output
            });
            const outputPath = getUniqueFilename(desiredPath);

            downloadImage(event.resultUrl, outputPath)
              .then(() => {
                completedImages++;
                log('✓', `Image ${completedImages}/${totalImages} completed (${elapsedSeconds.toFixed(2)}s)`);
                log('💾', `Saved: ${outputPath}`);
                openImage(outputPath);
                checkWorkflowCompletion();
              })
              .catch((error) => {
                failedImages++;
                if (error.message?.includes('Not Found') && !OPTIONS.disableSafeContentFilter) {
                  displaySafeContentFilterMessage({ showDisableHint: true });
                } else {
                  log('❌', `Download failed for ${imageId}: ${error.message}`);
                }
                checkWorkflowCompletion();
              });
          }

          if (!event.resultUrl || event.error) {
            checkWorkflowCompletion();
          }
          break;

        case 'error':
        case 'failed':
                    clearProgress();
          failedImages++;
          if (isSensitiveContentError(event) && !OPTIONS.disableSafeContentFilter) {
            displaySafeContentFilterMessage({ showDisableHint: true });
          } else {
            const errorMsg = event.error?.message || event.error || 'Unknown error';
            const errorCode = event.error?.code;
            if (errorCode !== undefined && errorCode !== null) {
              log('❌', `Job failed: ${errorMsg} (Error code: ${errorCode})`);
            } else {
              log('❌', `Job failed: ${errorMsg}`);
            }
          }
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

    function checkWorkflowCompletion() {
      if (etaCountdownInterval) {
        clearInterval(etaCountdownInterval);
        etaCountdownInterval = null;
      }
      if (completedImages + failedImages === totalImages) {
        if (failedImages === 0) {
          if (totalImages === 1) {
            log('🎉', 'Image generated successfully!');
          } else {
            log('🎉', `All ${totalImages} image${totalImages > 1 ? 's' : ''} generated successfully!`);
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

    // Wait for all jobs to complete - SDK and server handle their own timeouts
    await new Promise((resolve) => {
      const checkCompletion = () => {
        if (projectFailed || completedImages + failedImages >= totalImages) {
          resolve();
        } else {
          setTimeout(checkCompletion, 1000);
        }
      };
      checkCompletion();
    });

    // If checkWorkflowCompletion didn't already exit (e.g. project-level error before all jobs reported)
    if (projectFailed) {
      process.exit(1);
    }

  } catch (error) {
    log('❌', `Error: ${error.message}`);
    process.exit(1);
  }
}

async function getImageJobEstimate(tokenType, modelId, steps, inputImagePath, imageCount = 1) {
  const network = 'fast';
  const stepCount = steps;
  const previewCount = 0;
  const cnEnabled = false;
  const denoiseStrength = 1.0;

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
      // Use defaults
    }
  }

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
