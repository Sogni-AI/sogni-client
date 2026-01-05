#!/usr/bin/env node
/**
 * Image Generation Workflow (with Reference Images)
 *
 * This script generates images using reference/context images to guide the generation.
 * Works with Qwen Image Edit and Flux models that support context-based generation.
 *
 * Prerequisites:
 * - Set SOGNI_USERNAME and SOGNI_PASSWORD in .env file (or will prompt)
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
 *   --model       Model: qwen, qwen-lightning, or flux2 (default: prompts for selection)
 *   --batch       Number of images to generate (default: 1)
 *   --seed        Random seed for reproducibility (default: -1 for random)
 *   --guidance    Guidance scale for Flux2 (default: 4.0)
 *   --steps       Inference steps (default: model-specific)
 *   --sampler     Sampler name (default: euler)
 *   --scheduler   Scheduler name (default: simple)
 *   --negative    Negative prompt (default: none)
 *   --style       Style prompt (default: none)
 *   --output      Output directory (default: ./output)
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
  promptContextImages,
  pickImageFile,
  readFilesAsBuffers,
  log,
  displayConfig,
  displayPrompts
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
    output: './output',
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
    } else if (arg === '--context' && args[i + 1]) {
      options.contextImages[0] = args[++i];
    } else if (arg === '--context2' && args[i + 1]) {
      options.contextImages[1] = args[++i];
    } else if (arg === '--context3' && args[i + 1]) {
      options.contextImages[2] = args[++i];
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
Image Generation Workflow (with Reference Images)

This workflow generates new images using reference images to guide the style/content.
Works with Qwen Image Edit and Flux models that support context-based generation.

Usage:
  node workflow_image_edit.mjs                                    # Interactive mode
  node workflow_image_edit.mjs "portrait in this style" --context ref.jpg
  node workflow_image_edit.mjs "modern artwork" --context ref1.jpg --context2 ref2.jpg

Available Models:
  qwen           - Qwen Image Edit 2511 (high quality, 20-step)
  qwen-lightning - Qwen Image Edit 2511 Lightning (fast, 4-step)
  flux2          - Flux.2 Dev (high quality with context images)

Options:
  --context     Reference image 1 (required, at least 1 needed)
  --context2    Reference image 2 (optional)
  --context3    Reference image 3 (optional)
  --model       Model: qwen, qwen-lightning, or flux2 (default: prompts for selection)
  --negative    Negative prompt (default: none)
  --style       Style prompt (default: none)
  --batch       Number of images to generate (default: 1)
  --seed        Random seed (default: -1 for random)
  --guidance    Guidance scale for Flux2 (default: 4.0)
  --steps       Inference steps (default: model-specific)
  --sampler     Sampler name (default: euler)
  --scheduler   Scheduler name (default: simple)
  --output      Output directory (default: ./output)
  --no-interactive  Skip interactive prompts
  --help        Show this help message

Reference Images:
  Qwen and Flux models use reference images to guide the generation (not img2img editing).
  Provide 1-3 reference images that represent the style or content you want.
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
  const { username: USERNAME, password: PASSWORD } = await loadCredentials();

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
    const selection = await selectModel(MODELS.imageEdit, 'qwen');
    OPTIONS.modelKey = selection.key;
    modelConfig = selection.config;
  } else {
    OPTIONS.modelKey = OPTIONS.modelKey || 'qwen';
    modelConfig = MODELS.imageEdit[OPTIONS.modelKey];
    if (!modelConfig) {
      console.error(`Error: Unknown model '${OPTIONS.modelKey}'. Use 'qwen', 'qwen-lightning', or 'flux2'.`);
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

      // Ask for additional context images
      for (let i = 1; i < (modelConfig.maxContextImages || 3); i++) {
        const ordinal = i === 1 ? '2nd' : '3rd';
        const addMore = await askQuestion(`\nAdd ${ordinal} reference image? [y/N]: `);
        
        if (addMore.toLowerCase() === 'y' || addMore.toLowerCase() === 'yes') {
          try {
            const contextImage = await pickImageFile(null, `${ordinal} reference image`);
            OPTIONS.contextImages.push(contextImage);
            log('✓', `Added reference image ${i + 1}: ${contextImage}`);
          } catch (error) {
            log('⚠️', `Could not add reference image: ${error.message}`);
            break;
          }
        } else {
          break;
        }
      }
    }
    // Prompt
    if (!OPTIONS.prompt) {
      console.log(`\nDefault prompt: "${DEFAULT_PROMPT}"`);
      const promptInput = await askQuestion('Enter your generation prompt (or press Enter for default): ');
      OPTIONS.prompt = promptInput.trim() || DEFAULT_PROMPT;
    }

    // Batch count
    const batchInput = await askQuestion('\nNumber of images to generate (1-10, default: 1): ');
    if (batchInput.trim()) {
      const b = parseInt(batchInput.trim(), 10);
      if (b >= 1 && b <= 10) {
        OPTIONS.batch = b;
      }
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

  // Apply defaults
  if (!OPTIONS.prompt) OPTIONS.prompt = DEFAULT_PROMPT;

  // Validate batch count
  if (OPTIONS.batch < 1 || OPTIONS.batch > 10) {
    console.error('Error: Batch count must be between 1 and 10');
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

    // Get cost estimate
    log('💵', 'Fetching cost estimate...');
    const steps = OPTIONS.steps || modelConfig.defaultSteps;
    const estimate = await getImageJobEstimate(tokenType, modelConfig.id, steps, OPTIONS.contextImages[0]);

    console.log();
    console.log('📊 Cost Estimate:');

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

    // Show configuration
    const configDisplay = {
      'Model': modelConfig.name,
      'Prompt': OPTIONS.prompt,
      'Reference Images': OPTIONS.contextImages.length,
      'Batch': OPTIONS.batch,
      'Steps': steps,
      'Seed': OPTIONS.seed !== null ? OPTIONS.seed : -1
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

    // Create project
    log('📤', 'Submitting image generation job...');
    log('🎨', 'Generating image from references...');
    console.log();

    let startTime = Date.now();

    // CRITICAL: SDK requires Uint8Array/File/Blob objects for media uploads, NOT string paths.
    // Passing string paths will silently fail (the string text gets uploaded instead of file contents).
    const contextImageBuffers = readFilesAsBuffers(OPTIONS.contextImages);

    // Debug: Log the context images to verify they're Blobs
    console.log('\n🔍 DEBUG: Context image upload info:');
    contextImageBuffers.forEach((buf, i) => {
      const size = buf.size || buf.byteLength || 'unknown';
      console.log(`   Image ${i + 1}: ${buf.constructor.name}, ${size} bytes`);
    });

    const projectParams = {
      type: 'image',
      modelId: modelConfig.id,
      positivePrompt: OPTIONS.prompt,
      numberOfMedia: OPTIONS.batch,
      steps: steps,
      seed: OPTIONS.seed !== null ? OPTIONS.seed : -1,
      contextImages: contextImageBuffers,
      tokenType: tokenType
    };

    // Add width/height for Flux2 (it uses custom dimensions)
    if (modelConfig.supportsGuidance) {
      projectParams.sizePreset = 'custom';
      projectParams.width = modelConfig.defaultWidth || 1248;
      projectParams.height = modelConfig.defaultHeight || 832;
      // Flux2 always needs guidance
      projectParams.guidance = OPTIONS.guidance || modelConfig.defaultGuidance || 4.0;
    }

    // Add optional prompts
    if (OPTIONS.negative) {
      projectParams.negativePrompt = OPTIONS.negative;
    }
    if (OPTIONS.style) {
      projectParams.stylePrompt = OPTIONS.style;
    }

    // Debug: Log the full project params
    console.log('\n🔍 DEBUG: Project params:');
    console.log(`   modelId: ${projectParams.modelId}`);
    console.log(`   sizePreset: ${projectParams.sizePreset}`);
    console.log(`   width: ${projectParams.width}`);
    console.log(`   height: ${projectParams.height}`);
    console.log(`   steps: ${projectParams.steps}`);
    console.log(`   guidance: ${projectParams.guidance}`);
    console.log(`   contextImages count: ${projectParams.contextImages?.length}`);
    console.log();

    const project = await sogni.projects.create(projectParams);

    // Listen for project-level progress (0-100 percentage)
    project.on('progress', (progressPercent) => {
      process.stdout.write(`\r⏳ Progress: ${progressPercent}%`);
    });

    // Set up event handlers
    let completedImages = 0;
    let failedImages = 0;
    const totalImages = OPTIONS.batch;
    let projectFailed = false;

    const eventHandler = (event) => {
      // Handle step-level progress from job events
      if (event.type === 'progress' && event.step !== undefined && event.stepCount !== undefined) {
        const percent = Math.round((event.step / event.stepCount) * 100);
        process.stdout.write(`\r⏳ Step ${event.step}/${event.stepCount} (${percent}%)`);
      }

      switch (event.type) {
        case 'queued':
          log('📋', `Job queued at position: ${event.queuePosition || 'unknown'}`);
          break;

        case 'initiating':
          log('🔧', `Worker ${event.workerName || 'unknown'} initializing model...`);
          break;

        case 'started':
          log('🚀', `Worker ${event.workerName || 'unknown'} started generation`);
          break;

        case 'completed':
          // Debug: Log the full event (no truncation)
          console.log('\n🔍 DEBUG: Completed event:');
          console.log('   jobId:', event.jobId);
          console.log('   resultUrl:', event.resultUrl);
          console.log('   error:', event.error);
          console.log('   status:', event.status);
          
          if (!event.resultUrl || event.error) {
            failedImages++;
            log('❌', `Job completed with error: ${event.error || 'No result URL'}`);
          } else {
            if (projectFailed) {
              log('⚠️', 'Ignoring completion event for already failed project');
              return;
            }
            const imageId = event.jobId || `edited_${Date.now()}`;
            const outputPath = `${OPTIONS.output}/${imageId}.png`;

            downloadImage(event.resultUrl, outputPath)
              .then(() => {
                completedImages++;
                const elapsed = Math.round((Date.now() - startTime) / 1000);
                log('✓', `Image ${completedImages}/${totalImages} completed (${elapsed}s)`);
                log('💾', `Saved: ${outputPath}`);
                openImage(outputPath);
                checkWorkflowCompletion();
              })
              .catch((error) => {
                failedImages++;
                log('❌', `Download failed for ${imageId}: ${error.message}`);
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

    if (projectFailed || failedImages > 0) {
      const failureCount = projectFailed ? totalImages : failedImages;
      log('❌', `Image generation failed with ${failureCount} failed job${failureCount > 1 ? 's' : ''}`);
      process.exit(1);
    } else {
      log('✅', 'Image generation completed successfully!');
    }

  } catch (error) {
    log('❌', `Error: ${error.message}`);
    process.exit(1);
  }
}

async function getImageJobEstimate(tokenType, modelId, steps, inputImagePath) {
  const network = 'fast';
  const imageCount = 1;
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
  console.log('🔍 DEBUG: Downloading from URL:', url);
  const response = await fetch(url);
  if (!response.ok) {
    console.log('🔍 DEBUG: Download response status:', response.status, response.statusText);
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
