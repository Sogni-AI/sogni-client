#!/usr/bin/env node
/**
 * Multiple Angles LoRA Workflow
 *
 * This script demonstrates the Multiple Angles LoRA for Qwen Image Edit 2511,
 * which generates character/object turnarounds from specific camera angles.
 *
 * The LoRA supports 96 camera pose combinations:
 * - 8 Azimuths: front, front-right quarter, right side, back-right quarter,
 *               back, back-left quarter, left side, front-left quarter
 * - 4 Elevations: low-angle (-30°), eye-level (0°), elevated (30°), high-angle (60°)
 * - 3 Distances: close-up (×0.6), medium shot (×1.0), wide shot (×1.8)
 *
 * Prerequisites:
 * - Set SOGNI_USERNAME and SOGNI_PASSWORD in .env file (or will prompt)
 * - You need access to the 'fast' network for image generation
 *
 * Usage:
 *   node workflow_multiple_angles.mjs                              # Interactive mode
 *   node workflow_multiple_angles.mjs --context subject.jpg        # With reference image
 *   node workflow_multiple_angles.mjs --context cat.jpg --azimuth front --elevation eye-level
 *
 * Options:
 *   --context       Reference image of the subject (required)
 *   --azimuth       Camera angle: front, front-right, right, back-right, back,
 *                   back-left, left, front-left (default: front)
 *   --elevation     Camera height: low-angle, eye-level, elevated, high-angle (default: eye-level)
 *   --distance      Shot type: close-up, medium, wide (default: medium)
 *   --strength      LoRA strength 0.0-1.5 (default: 0.9)
 *   --description   Additional description of the subject (optional)
 *   --width         Output image width (default: 1024)
 *   --height        Output image height (default: 1024)
 *   --batch         Number of images to generate (default: 1)
 *   --seed          Random seed for reproducibility (default: -1)
 *   --steps         Inference steps (default: 20)
 *   --output        Output directory (default: ./output)
 *   --no-interactive  Skip interactive prompts
 *   --help          Show this help message
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
  promptBatchCount,
  pickImageFile,
  readFileAsBuffer,
  log,
  displayConfig,
  getUniqueFilename,
  generateImageFilename,
  generateRandomSeed
} from './workflow-helpers.mjs';

const streamPipeline = promisify(pipeline);

// LoRA configuration - using LoRA ID (resolved to filename by worker via config API)
const LORA_ID = 'multiple_angles';

// Available models for Multiple Angles LoRA (Qwen Image Edit variants only)
const AVAILABLE_MODELS = {
  'qwen-lightning': MODELS.imageEdit['qwen-lightning'],
  'qwen': MODELS.imageEdit['qwen']
};

// Camera pose options (96 total combinations)
const AZIMUTHS = [
  { key: 'front', label: 'Front view', prompt: 'front view' },
  { key: 'front-right', label: 'Front-right quarter', prompt: 'front-right quarter view' },
  { key: 'right', label: 'Right side', prompt: 'right side view' },
  { key: 'back-right', label: 'Back-right quarter', prompt: 'back-right quarter view' },
  { key: 'back', label: 'Back view', prompt: 'back view' },
  { key: 'back-left', label: 'Back-left quarter', prompt: 'back-left quarter view' },
  { key: 'left', label: 'Left side', prompt: 'left side view' },
  { key: 'front-left', label: 'Front-left quarter', prompt: 'front-left quarter view' },
];

const ELEVATIONS = [
  { key: 'low-angle', label: 'Low angle (-30°)', prompt: 'low-angle shot' },
  { key: 'eye-level', label: 'Eye level (0°)', prompt: 'eye-level shot' },
  { key: 'elevated', label: 'Elevated (30°)', prompt: 'elevated shot' },
  { key: 'high-angle', label: 'High angle (60°)', prompt: 'high-angle shot' },
];

const DISTANCES = [
  { key: 'close-up', label: 'Close-up (×0.6)', prompt: 'close-up' },
  { key: 'medium', label: 'Medium shot (×1.0)', prompt: 'medium shot' },
  { key: 'wide', label: 'Wide shot (×1.8)', prompt: 'wide shot' },
];

// ============================================
// Parse Command Line Arguments
// ============================================

async function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    contextImage: null,
    modelKey: null,  // Will prompt or default to 'qwen-lightning'
    azimuth: 'front',
    elevation: 'eye-level',
    distance: 'medium',
    strength: 0.9,
    guidance: null,  // Will use model default
    description: '',
    batch: 1,
    seed: null,
    steps: null,
    width: 1024,
    height: 1024,
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
    } else if (arg === '--model' && args[i + 1]) {
      options.modelKey = args[++i];
    } else if ((arg === '--context' || arg === '--image') && args[i + 1]) {
      options.contextImage = args[++i];
    } else if (arg === '--guidance' && args[i + 1]) {
      options.guidance = parseFloat(args[++i]);
    } else if (arg === '--azimuth' && args[i + 1]) {
      options.azimuth = args[++i];
    } else if (arg === '--elevation' && args[i + 1]) {
      options.elevation = args[++i];
    } else if (arg === '--distance' && args[i + 1]) {
      options.distance = args[++i];
    } else if (arg === '--strength' && args[i + 1]) {
      options.strength = parseFloat(args[++i]);
    } else if ((arg === '--description' || arg === '--anchor') && args[i + 1]) {
      options.description = args[++i];
    } else if (arg === '--batch' && args[i + 1]) {
      options.batch = parseInt(args[++i], 10);
    } else if (arg === '--seed' && args[i + 1]) {
      options.seed = parseInt(args[++i], 10);
    } else if (arg === '--steps' && args[i + 1]) {
      options.steps = parseInt(args[++i], 10);
    } else if (arg === '--width' && args[i + 1]) {
      options.width = parseInt(args[++i], 10);
    } else if (arg === '--height' && args[i + 1]) {
      options.height = parseInt(args[++i], 10);
    } else if (arg === '--output' && args[i + 1]) {
      options.output = args[++i];
    } else if (!arg.startsWith('--') && !options.description) {
      options.description = arg;
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
Multiple Angles LoRA Workflow

Generates character/object turnarounds from specific camera angles using the
Multiple Angles LoRA for Qwen Image Edit 2511.

Usage:
  node workflow_multiple_angles.mjs                                    # Interactive
  node workflow_multiple_angles.mjs --context subject.jpg              # With image
  node workflow_multiple_angles.mjs --context cat.jpg --azimuth back   # Back view
  node workflow_multiple_angles.mjs --context cat.jpg --model qwen     # High quality mode

Models:
  qwen-lightning  - Fast 4-step generation, guidance 1.0 (default)
  qwen            - High quality 20-step generation, guidance 4.0

Camera Pose Options (96 combinations):

  Azimuths (--azimuth):
    front, front-right, right, back-right, back, back-left, left, front-left

  Elevations (--elevation):
    low-angle (-30°), eye-level (0°), elevated (30°), high-angle (60°)

  Distances (--distance):
    close-up (×0.6), medium (×1.0), wide (×1.8)

Options:
  --model         Model: qwen-lightning (fast) or qwen (quality) (default: qwen-lightning)
  --context       Reference image of the subject (required)
  --azimuth       Camera horizontal angle (default: front)
  --elevation     Camera vertical angle (default: eye-level)
  --distance      Shot distance (default: medium)
  --strength      LoRA strength 0.0-1.5 (default: 0.9)
  --guidance      Guidance scale (default: model-specific)
  --anchor        Short anchor phrase to prevent drift (usually not needed)
  --width         Output width (default: 1024)
  --height        Output height (default: 1024)
  --batch         Number of images (default: 1)
  --seed          Random seed (default: -1)
  --steps         Inference steps (default: model-specific)
  --output        Output directory (default: ./output)
  --no-interactive  Skip interactive prompts
  --help          Show this help

Examples:
  # Generate back view of a character (fast mode)
  node workflow_multiple_angles.mjs --context character.jpg --azimuth back

  # Generate high quality back view
  node workflow_multiple_angles.mjs --context character.jpg --azimuth back --model qwen

  # Generate high-angle close-up from the left
  node workflow_multiple_angles.mjs --context obj.jpg --azimuth left --elevation high-angle --distance close-up

  # Generate multiple angles in batch
  node workflow_multiple_angles.mjs --context cat.jpg --batch 4
`);
}

// ============================================
// Build Prompt with Activation Keyword
// ============================================

function buildPrompt(options) {
  const azimuthConfig = AZIMUTHS.find(a => a.key === options.azimuth) || AZIMUTHS[0];
  const elevationConfig = ELEVATIONS.find(e => e.key === options.elevation) || ELEVATIONS[1];
  const distanceConfig = DISTANCES.find(d => d.key === options.distance) || DISTANCES[1];

  // Build the prompt with activation keyword <sks> immediately followed by camera pose
  // Note: LoRA is applied via loras/loraStrengths arrays, NOT prompt syntax
  const parts = [
    '<sks>',  // Activation keyword for Multiple Angles LoRA
    azimuthConfig.prompt,
    elevationConfig.prompt,
    distanceConfig.prompt
  ];

  // Add optional description at the end
  if (options.description) {
    parts.push(options.description);
  }

  return parts.join(' ');
}

// ============================================
// Interactive Selection Helpers
// ============================================

async function selectFromList(items, label, defaultKey) {
  console.log(`\n${label}:\n`);
  items.forEach((item, i) => {
    const marker = item.key === defaultKey ? ' (default)' : '';
    console.log(`  ${i + 1}. ${item.label}${marker}`);
  });
  console.log();

  const defaultIndex = items.findIndex(i => i.key === defaultKey) + 1;
  const answer = await askQuestion(`Enter choice [1-${items.length}] (default: ${defaultIndex}): `);
  const choice = parseInt(answer.trim(), 10);

  if (choice >= 1 && choice <= items.length) {
    return items[choice - 1].key;
  }
  return defaultKey;
}

// ============================================
// Main Logic
// ============================================

async function main() {
  const OPTIONS = await parseArgs();

  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║         Multiple Angles LoRA Workflow                    ║');
  console.log('║   Generate turnarounds from 96 camera pose combinations  ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log();

  // Load credentials
  const { username: USERNAME, password: PASSWORD } = await loadCredentials();

  // Select model (interactive or from CLI)
  let modelConfig;
  if (OPTIONS.interactive && !OPTIONS.modelKey) {
    console.log('📦 Select Model:\n');
    console.log('  1. Qwen Image Edit 2511 Lightning - Fast 4-step generation (default)');
    console.log('  2. Qwen Image Edit 2511 - High quality 20-step generation');
    console.log();

    const modelChoice = await askQuestion('Enter choice [1/2] (default: 1): ');
    const choice = modelChoice.trim() || '1';

    if (choice === '2' || choice.toLowerCase() === 'qwen') {
      OPTIONS.modelKey = 'qwen';
      console.log('  → Using Qwen Image Edit 2511 (high quality)\n');
    } else {
      OPTIONS.modelKey = 'qwen-lightning';
      console.log('  → Using Qwen Image Edit 2511 Lightning (fast)\n');
    }
  } else {
    OPTIONS.modelKey = OPTIONS.modelKey || 'qwen-lightning';
  }

  // Validate and get model config
  modelConfig = AVAILABLE_MODELS[OPTIONS.modelKey];
  if (!modelConfig) {
    console.error(`Error: Unknown model '${OPTIONS.modelKey}'. Valid options: qwen-lightning, qwen`);
    process.exit(1);
  }

  log('🎨', `Selected model: ${modelConfig.name}`);

  // Interactive mode
  if (OPTIONS.interactive) {
    console.log('\n📸 This workflow generates views from specific camera angles.');
    console.log('   Provide a reference image of your subject (character, object, etc.).\n');

    // Get reference image
    if (!OPTIONS.contextImage) {
      OPTIONS.contextImage = await pickImageFile(null, 'reference image of subject');
    }

    log('✓', `Reference image: ${OPTIONS.contextImage}`);

    // Get image dimensions for display
    let imageDimensions = { width: 1024, height: 1024 };
    try {
      const dimensions = imageSize(OPTIONS.contextImage);
      if (dimensions.width && dimensions.height) {
        imageDimensions = { width: dimensions.width, height: dimensions.height };
      }
    } catch (error) {
      // Use defaults
    }
    console.log(`   Dimensions: ${imageDimensions.width} x ${imageDimensions.height}`);

    // Optional anchor description (usually not needed)
    console.log('\n💡 Usually no description is needed - the LoRA handles pose from the reference image.');
    console.log('   Only add a short anchor phrase if you notice drift in the output.');
    console.log('   Example: "camera is behind the boxer"');
    const descInput = await askQuestion('\nAnchor description (usually skip, press Enter): ');
    if (descInput.trim()) {
      OPTIONS.description = descInput.trim();
    }

    // Camera pose selection
    console.log('\n📐 Select Camera Pose (96 combinations available)\n');

    OPTIONS.azimuth = await selectFromList(AZIMUTHS, '🔄 Azimuth (horizontal angle)', OPTIONS.azimuth);
    OPTIONS.elevation = await selectFromList(ELEVATIONS, '📏 Elevation (vertical angle)', OPTIONS.elevation);
    OPTIONS.distance = await selectFromList(DISTANCES, '📷 Distance (shot type)', OPTIONS.distance);

    // Advanced options
    const advancedChoice = await askQuestion('\nCustomize advanced options? [y/N]: ');
    if (advancedChoice.toLowerCase() === 'y' || advancedChoice.toLowerCase() === 'yes') {
      // LoRA strength
      const strengthInput = await askQuestion(`LoRA strength (0.0-1.5, default: ${OPTIONS.strength}): `);
      if (strengthInput.trim()) {
        const s = parseFloat(strengthInput.trim());
        if (!isNaN(s) && s >= 0 && s <= 1.5) {
          OPTIONS.strength = s;
        }
      }

      // Steps
      const stepsInput = await askQuestion(`Steps (${modelConfig.minSteps}-${modelConfig.maxSteps}, default: ${modelConfig.defaultSteps}): `);
      if (stepsInput.trim()) {
        const s = parseInt(stepsInput.trim(), 10);
        if (!isNaN(s) && s >= modelConfig.minSteps && s <= modelConfig.maxSteps) {
          OPTIONS.steps = s;
        }
      }

      // Guidance
      const guidanceInput = await askQuestion(`Guidance (${modelConfig.minGuidance}-${modelConfig.maxGuidance}, default: ${modelConfig.defaultGuidance}): `);
      if (guidanceInput.trim()) {
        const g = parseFloat(guidanceInput.trim());
        if (!isNaN(g) && g >= modelConfig.minGuidance && g <= modelConfig.maxGuidance) {
          OPTIONS.guidance = g;
        }
      }

      // Dimensions
      const widthInput = await askQuestion(`Width (default: ${OPTIONS.width}): `);
      if (widthInput.trim()) {
        const w = parseInt(widthInput.trim(), 10);
        if (!isNaN(w) && w > 0 && w <= modelConfig.maxWidth) {
          OPTIONS.width = w;
        }
      }

      const heightInput = await askQuestion(`Height (default: ${OPTIONS.height}): `);
      if (heightInput.trim()) {
        const h = parseInt(heightInput.trim(), 10);
        if (!isNaN(h) && h > 0 && h <= modelConfig.maxHeight) {
          OPTIONS.height = h;
        }
      }

      // Seed
      const seedInput = await askQuestion('Seed (-1 for random, default: -1): ');
      if (seedInput.trim()) {
        const seed = parseInt(seedInput.trim(), 10);
        if (!isNaN(seed)) {
          OPTIONS.seed = seed;
        }
      }
    }

    console.log('\n✅ Configuration complete!\n');
  }

  // Validate reference image
  if (!OPTIONS.contextImage) {
    console.error('Error: Reference image is required (use --context option)');
    process.exit(1);
  }
  if (!fs.existsSync(OPTIONS.contextImage)) {
    console.error(`Error: Reference image '${OPTIONS.contextImage}' does not exist`);
    process.exit(1);
  }

  // Apply defaults
  if (!OPTIONS.steps) OPTIONS.steps = modelConfig.defaultSteps;
  if (OPTIONS.guidance === null) OPTIONS.guidance = modelConfig.defaultGuidance;

  // Validate camera pose options
  if (!AZIMUTHS.find(a => a.key === OPTIONS.azimuth)) {
    console.error(`Error: Invalid azimuth '${OPTIONS.azimuth}'. Valid options: ${AZIMUTHS.map(a => a.key).join(', ')}`);
    process.exit(1);
  }
  if (!ELEVATIONS.find(e => e.key === OPTIONS.elevation)) {
    console.error(`Error: Invalid elevation '${OPTIONS.elevation}'. Valid options: ${ELEVATIONS.map(e => e.key).join(', ')}`);
    process.exit(1);
  }
  if (!DISTANCES.find(d => d.key === OPTIONS.distance)) {
    console.error(`Error: Invalid distance '${OPTIONS.distance}'. Valid options: ${DISTANCES.map(d => d.key).join(', ')}`);
    process.exit(1);
  }

  // Build prompt
  const prompt = buildPrompt(OPTIONS);

  // Create output directory
  if (!fs.existsSync(OPTIONS.output)) {
    fs.mkdirSync(OPTIONS.output, { recursive: true });
  }

  // Initialize client
  const clientConfig = {
    appId: `sogni-workflow-multiple-angles-${Date.now()}`,
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
      }
    } else {
      console.log(`💳 Using saved payment preference: ${tokenType.charAt(0).toUpperCase() + tokenType.slice(1)} tokens\n`);
    }

    // Ask for batch count as last question before confirmation
    if (OPTIONS.interactive) {
      await promptBatchCount(OPTIONS, { isVideo: false });
    }

    // Get camera pose labels for display
    const azimuthLabel = AZIMUTHS.find(a => a.key === OPTIONS.azimuth)?.label || OPTIONS.azimuth;
    const elevationLabel = ELEVATIONS.find(e => e.key === OPTIONS.elevation)?.label || OPTIONS.elevation;
    const distanceLabel = DISTANCES.find(d => d.key === OPTIONS.distance)?.label || OPTIONS.distance;

    // Show configuration
    const configDisplay = {
      'Model': `${modelConfig.name} + Multiple Angles LoRA`,
      'Reference': OPTIONS.contextImage,
      'Azimuth': azimuthLabel,
      'Elevation': elevationLabel,
      'Distance': distanceLabel,
      'LoRA Strength': OPTIONS.strength.toFixed(2),
      'Dimensions': `${OPTIONS.width} x ${OPTIONS.height}`,
      'Steps': OPTIONS.steps,
      'Guidance': OPTIONS.guidance,
      'Batch': OPTIONS.batch,
      'Seed': OPTIONS.seed !== null ? OPTIONS.seed : -1
    };

    if (OPTIONS.description) {
      configDisplay['Anchor'] = OPTIONS.description;
    }

    displayConfig('Multiple Angles Configuration', configDisplay);

    console.log('\n📝 Generated Prompt:');
    console.log(`   ${prompt}\n`);

    // Confirm
    if (OPTIONS.interactive) {
      const proceed = await askQuestion('Proceed with generation? [Y/n]: ');
      if (proceed.toLowerCase() === 'n' || proceed.toLowerCase() === 'no') {
        log('❌', 'Generation cancelled');
        process.exit(0);
      }
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
    log('📤', 'Submitting multiple angles generation job...');
    log('🎨', `Generating ${azimuthLabel} ${elevationLabel} ${distanceLabel}...`);
    console.log();

    let startTime = Date.now();

    // Read reference image as buffer
    const contextImageBuffer = readFileAsBuffer(OPTIONS.contextImage);

    const projectParams = {
      type: 'image',
      modelId: modelConfig.id,
      positivePrompt: prompt,
      numberOfMedia: OPTIONS.batch,
      steps: OPTIONS.steps,
      guidance: OPTIONS.guidance,
      seed: OPTIONS.seed,
      contextImages: [contextImageBuffer],
      tokenType: tokenType,
      sizePreset: 'custom',
      width: OPTIONS.width,
      height: OPTIONS.height,
      outputFormat: 'jpg',
      sampler: modelConfig.defaultComfySampler,
      scheduler: modelConfig.defaultComfyScheduler,
      // LoRA configuration - using LoRA IDs (resolved to filenames by worker via config API)
      loras: [LORA_ID],
      loraStrengths: [OPTIONS.strength],
    };

    const project = await sogni.projects.create(projectParams);

    // Set up event handlers
    let completedImages = 0;
    let failedImages = 0;
    const totalImages = OPTIONS.batch;
    let projectFailed = false;
    let currentStep = undefined;
    let totalSteps = undefined;
    let progressLineActive = false;

    const clearProgress = () => {
      if (progressLineActive) {
        process.stdout.write('\r' + ' '.repeat(70) + '\r');
        progressLineActive = false;
      }
    };

    const updateProgressDisplay = () => {
      if (currentStep !== undefined && totalSteps !== undefined) {
        const percent = Math.round((currentStep / totalSteps) * 100);
        process.stdout.write(`\r⏳ Step ${currentStep}/${totalSteps} (${percent}%)   `);
        progressLineActive = true;
      }
    };

    const eventHandler = (event) => {
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

        case 'completed':
                    if (!event.jobId) return;
          clearProgress();

          if (!event.resultUrl || event.error) {
            failedImages++;
            log('❌', `Job completed with error: ${event.error || 'No result URL'}`);
          } else {
            if (projectFailed) return;

            // Calculate elapsed time for this image
            const elapsedSeconds = (Date.now() - startTime) / 1000;

            // Use actual seed from job completion event (server generates unique seeds for batch items)
            const jobIndex = completedImages + failedImages;
            const jobSeed = event.seed ?? (OPTIONS.seed + jobIndex);

            const desiredPath = generateImageFilename({
              modelId: modelConfig.id,
              width: OPTIONS.width,
              height: OPTIONS.height,
              seed: jobSeed,
              prompt: prompt,
              generationTime: elapsedSeconds,
              outputFormat: 'jpg',
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
                log('❌', `Download failed: ${error.message}`);
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
          projectFailed = true;
          failedImages++;
          const errorMsg = event.error?.message || event.error || 'Unknown error';
          log('❌', `Job failed: ${errorMsg}`);
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
          log('🎉', `All ${totalImages} image${totalImages > 1 ? 's' : ''} generated successfully!`);
          console.log();
          process.exit(0);
        } else {
          log('❌', `${failedImages} out of ${totalImages} image${totalImages > 1 ? 's' : ''} failed`);
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

  } catch (error) {
    log('❌', `Error: ${error.message}`);
    process.exit(1);
  }
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
    }
  });
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
