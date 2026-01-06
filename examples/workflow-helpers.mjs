/**
 * Shared Helper Functions for Workflow Scripts
 *
 * This module provides common interactive prompts and model configurations
 * for all workflow example scripts.
 */

import * as readline from 'node:readline';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ============================================
// Model Configurations
// ============================================

/**
 * Model configurations for all supported workflows.
 * Each model has a display name, internal ID, and workflow-specific settings.
 */
export const MODELS = {
  // Text-to-Image Models (ComfyUI worker)
  image: {
    'z-turbo': {
      id: 'z_image_turbo_bf16',
      name: 'Z-Image Turbo',
      description: 'Fast generation with good quality',
      defaultWidth: 1024,
      defaultHeight: 1024,
      minSteps: 4,
      maxSteps: 10,
      defaultSteps: 4,
      supportsGuidance: true,
      defaultGuidance: 1.0,
      minGuidance: 0.6,
      maxGuidance: 1.6,
      supportsDenoise: true,
      defaultDenoise: 0.7,
      isComfyModel: true,
      defaultComfySampler: 'res_multistep',
      defaultComfyScheduler: 'simple'
    },
    'flux2': {
      id: 'flux2_dev_fp8',
      name: 'Flux.2 Dev',
      description: 'Highest quality, supports context images.',
      defaultWidth: 1248,
      defaultHeight: 832,
      minSteps: 20,
      maxSteps: 50,
      defaultSteps: 20,
      supportsGuidance: true,
      defaultGuidance: 4.0,
      minGuidance: 3.0,
      maxGuidance: 6.0,
      supportsContextImages: true,
      maxContextImages: 3,
      isComfyModel: true,
      defaultComfySampler: 'euler'
    }
  },

  // Image Edit Models (ComfyUI worker)
  imageEdit: {
    'qwen-lightning': {
      id: 'qwen_image_edit_2511_fp8_lightning',
      name: 'Qwen Image Edit 2511 Lightning',
      description: 'Fast 4-step image editing (recommended)',
      defaultSteps: 4,
      minSteps: 4,
      maxSteps: 8,
      supportsContextImages: true,
      maxContextImages: 3,
      isComfyModel: true,
      defaultComfySampler: 'euler',
      defaultComfyScheduler: 'simple',
      defaultGuidance: 1.0,
      minGuidance: 0.6,
      maxGuidance: 1.6
    },
    'qwen': {
      id: 'qwen_image_edit_2511_fp8',
      name: 'Qwen Image Edit 2511',
      description: 'High quality image editing, supports context images',
      defaultSteps: 20,
      minSteps: 20,
      maxSteps: 50,
      supportsContextImages: true,
      maxContextImages: 3,
      isComfyModel: true,
      defaultComfySampler: 'euler',
      defaultComfyScheduler: 'simple',
      defaultGuidance: 4.0,
      minGuidance: 4.0,
      maxGuidance: 4.0
    },
    'flux2': {
      id: 'flux2_dev_fp8',
      name: 'Flux.2 Dev',
      description: 'Highest quality, supports context images.',
      defaultWidth: 1248,
      defaultHeight: 832,
      defaultSteps: 20,
      minSteps: 20,
      maxSteps: 50,
      supportsGuidance: true,
      defaultGuidance: 4.0,
      minGuidance: 3.0,
      maxGuidance: 6.0,
      supportsContextImages: true,
      maxContextImages: 3,
      isComfyModel: true,
      defaultComfySampler: 'euler'
    }
  },

  // Text-to-Video Models (ComfyUI workflow)
  t2v: {
    'lightx2v': {
      id: 'wan_v2.2-14b-fp8_t2v_lightx2v',
      name: 'WAN 2.2 14B FP8 T2V LightX2V',
      description: 'Fast 4-step generation (recommended)',
      defaultSteps: 4,
      minSteps: 4,
      maxSteps: 8,
      defaultShift: 5.0,
      defaultGuidance: 1.0,
      minGuidance: 0.7,
      maxGuidance: 1.6,
      // ComfyUI format (preferred for video models)
      defaultComfySampler: 'euler',
      defaultComfyScheduler: 'simple',
      maxFrames: 161,
      isLightning: true,
      isComfyModel: true
    },
    'quality': {
      id: 'wan_v2.2-14b-fp8_t2v',
      name: 'WAN 2.2 14B FP8 T2V',
      description: 'High quality 20-step generation',
      defaultSteps: 20,
      minSteps: 20,
      maxSteps: 40,
      defaultShift: 8.0,
      defaultGuidance: 3.5,
      minGuidance: 1.5,
      maxGuidance: 8.0,
      // ComfyUI format (preferred for video models)
      defaultComfySampler: 'euler',
      defaultComfyScheduler: 'simple',
      maxFrames: 161,
      isLightning: false,
      isComfyModel: true
    }
  },

  // Image-to-Video Models (ComfyUI workflow)
  i2v: {
    'lightx2v': {
      id: 'wan_v2.2-14b-fp8_i2v_lightx2v',
      name: 'WAN 2.2 14B FP8 I2V LightX2V',
      description: 'Fast 4-step generation (recommended)',
      defaultSteps: 4,
      minSteps: 4,
      maxSteps: 8,
      defaultShift: 5.0,
      defaultGuidance: 1.0,
      minGuidance: 0.7,
      maxGuidance: 1.6,
      // ComfyUI format (preferred for video models)
      defaultComfySampler: 'euler',
      defaultComfyScheduler: 'simple',
      maxFrames: 161,
      isLightning: true,
      isComfyModel: true
    },
    'quality': {
      id: 'wan_v2.2-14b-fp8_i2v',
      name: 'WAN 2.2 14B FP8 I2V',
      description: 'High quality 20-step generation',
      defaultSteps: 20,
      minSteps: 20,
      maxSteps: 40,
      defaultShift: 8.0,
      defaultGuidance: 4.0,
      minGuidance: 1.5,
      maxGuidance: 8.0,
      // ComfyUI format (preferred for video models)
      defaultComfySampler: 'euler',
      defaultComfyScheduler: 'simple',
      maxFrames: 161,
      isLightning: false,
      isComfyModel: true
    }
  },

  // Sound-to-Video Models (ComfyUI workflow)
  s2v: {
    'lightx2v': {
      id: 'wan_v2.2-14b-fp8_s2v_lightx2v',
      name: 'WAN 2.2 14B FP8 S2V LightX2V',
      description: 'Fast 4-step generation (recommended)',
      defaultSteps: 4,
      minSteps: 4,
      maxSteps: 8,
      defaultShift: 8.0, // S2V uses 8.0 even for lightx2v
      defaultGuidance: 1.0,
      minGuidance: 0.7,
      maxGuidance: 1.6,
      // ComfyUI format (preferred for video models)
      defaultComfySampler: 'uni_pc', // S2V uses uni_pc
      defaultComfyScheduler: 'simple',
      maxFrames: 321, // S2V supports longer videos
      isLightning: true,
      isComfyModel: true
    },
    'quality': {
      id: 'wan_v2.2-14b-fp8_s2v',
      name: 'WAN 2.2 14B FP8 S2V',
      description: 'High quality 20-step generation',
      defaultSteps: 20,
      minSteps: 20,
      maxSteps: 40,
      defaultShift: 8.0,
      defaultGuidance: 6.0, // S2V quality uses higher guidance
      minGuidance: 1.5,
      maxGuidance: 8.0,
      // ComfyUI format (preferred for video models)
      defaultComfySampler: 'uni_pc', // S2V uses uni_pc
      defaultComfyScheduler: 'simple',
      maxFrames: 321, // S2V supports longer videos
      isLightning: false,
      isComfyModel: true
    }
  },

  // Video-to-Video (Animate) Models (ComfyUI workflow)
  animate: {
    'move-lightx2v': {
      id: 'wan_v2.2-14b-fp8_animate-move_lightx2v',
      name: 'WAN 2.2 14B FP8 Animate-Move LightX2V',
      description: 'Fast camera movement animation (recommended)',
      workflowType: 'animate-move',
      defaultSteps: 6, // Animate Lightning uses 6 steps
      minSteps: 4,
      maxSteps: 8,
      defaultShift: 8.0,
      defaultGuidance: 1.0,
      minGuidance: 0.7,
      maxGuidance: 1.6,
      // ComfyUI format (preferred for video models)
      defaultComfySampler: 'euler',
      defaultComfyScheduler: 'simple',
      maxFrames: 321,
      isLightning: true,
      isComfyModel: true
    },
    'move-quality': {
      id: 'wan_v2.2-14b-fp8_animate-move',
      name: 'WAN 2.2 14B FP8 Animate-Move',
      description: 'High quality camera movement animation',
      workflowType: 'animate-move',
      defaultSteps: 20,
      minSteps: 20,
      maxSteps: 40,
      defaultShift: 8.0,
      defaultGuidance: 4.0,
      minGuidance: 1.5,
      maxGuidance: 8.0,
      // ComfyUI format (preferred for video models)
      defaultComfySampler: 'euler',
      defaultComfyScheduler: 'simple',
      maxFrames: 321,
      isLightning: false,
      isComfyModel: true
    },
    'replace-lightx2v': {
      id: 'wan_v2.2-14b-fp8_animate-replace_lightx2v',
      name: 'WAN 2.2 14B FP8 Animate-Replace LightX2V',
      description: 'Fast subject replacement (recommended)',
      workflowType: 'animate-replace',
      defaultSteps: 6, // Animate Lightning uses 6 steps
      minSteps: 4,
      maxSteps: 8,
      defaultShift: 8.0,
      defaultGuidance: 1.0,
      minGuidance: 0.7,
      maxGuidance: 1.6,
      // ComfyUI format (preferred for video models)
      defaultComfySampler: 'euler',
      defaultComfyScheduler: 'simple',
      maxFrames: 321,
      isLightning: true,
      supportsSam2Coordinates: true,
      isComfyModel: true
    },
    'replace-quality': {
      id: 'wan_v2.2-14b-fp8_animate-replace',
      name: 'WAN 2.2 14B FP8 Animate-Replace',
      description: 'High quality subject replacement',
      workflowType: 'animate-replace',
      defaultSteps: 20,
      minSteps: 20,
      maxSteps: 40,
      defaultShift: 8.0,
      defaultGuidance: 4.0,
      minGuidance: 1.5,
      maxGuidance: 8.0,
      // ComfyUI format (preferred for video models)
      defaultComfySampler: 'euler',
      defaultComfyScheduler: 'simple',
      maxFrames: 321,
      isLightning: false,
      supportsSam2Coordinates: true,
      isComfyModel: true
    }
  }
};

// ============================================
// Video Parameter Constraints
// ============================================

// Base constraints - note that frames.max may be overridden by model-specific maxFrames
export const VIDEO_CONSTRAINTS = {
  width: { min: 480, max: 1536, default: 640, step: 16 },
  height: { min: 480, max: 1536, default: 640, step: 16 },
  frames: { min: 17, max: 161, default: 81 }, // Some models support max: 321
  fps: { allowedValues: [16, 32], default: 16 },
  shift: { min: 1.0, max: 8.0, default: 8.0, step: 0.1 },
  // Guidance ranges differ by model type:
  // Quality models: min: 1.5, max: 8.0
  // Lightning models: min: 0.7, max: 1.6
  guidance: {
    quality: { min: 1.5, max: 8.0, step: 0.01 },
    lightning: { min: 0.7, max: 1.6, step: 0.01 }
  }
};

// ============================================
// Sampler and Scheduler Options
// ============================================

// ComfyUI samplers (lowercase format)
export const COMFY_SAMPLERS = [
  { id: 'euler', name: 'Euler', description: 'Default, fast and stable' },
  { id: 'euler_ancestral', name: 'Euler Ancestral', description: 'More creative variations' },
  { id: 'res_multistep', name: 'Res Multistep', description: 'Optimized for Z-Image Turbo' },
  { id: 'dpmpp_2m', name: 'DPM++ 2M', description: 'Good quality, moderate speed' },
  { id: 'dpmpp_2m_sde', name: 'DPM++ 2M SDE', description: 'Higher quality, slower' },
  { id: 'dpmpp_sde', name: 'DPM++ SDE', description: 'High quality sampling' },
  { id: 'uni_pc', name: 'UniPC', description: 'Recommended for S2V workflows' },
  { id: 'lcm', name: 'LCM', description: 'Latent Consistency Model - very fast' },
  { id: 'ddim', name: 'DDIM', description: 'Denoising Diffusion Implicit Models' }
];

// ComfyUI schedulers for video models (lowercase format)
export const COMFY_SCHEDULERS = [
  { id: 'simple', name: 'Simple', description: 'Default scheduler' },
  { id: 'normal', name: 'Normal', description: 'Standard scheduling' },
  { id: 'karras', name: 'Karras', description: 'Smoother noise schedule' },
  { id: 'sgm_uniform', name: 'SGM Uniform', description: 'Uniform step spacing' },
  { id: 'beta', name: 'Beta', description: 'Beta noise schedule' },
  { id: 'exponential', name: 'Exponential', description: 'Exponential noise schedule' }
];

// Legacy aliases for backwards compatibility
export const SAMPLERS = COMFY_SAMPLERS;
export const SCHEDULERS = COMFY_SCHEDULERS;

// ============================================
// Interactive Prompts
// ============================================

/**
 * Ask a single question and return the answer
 */
export async function askQuestion(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(typeof answer === 'string' ? answer.trim() : '');
    });
  });
}

/**
 * Interactively pick an image file from test-assets or images directory
 * @param {string|null} defaultImage - Image path provided via CLI
 * @param {string} label - Label for the image type (e.g., 'input image', 'reference image')
 * @returns {Promise<string>} Selected image path
 */
export async function pickImageFile(defaultImage = null, label = 'input image') {
  // If image was provided via CLI and exists, use it
  if (defaultImage && fs.existsSync(defaultImage)) {
    return defaultImage;
  }

  // If not TTY, error out
  if (!process.stdin.isTTY) {
    throw new Error(
      `No ${label} found. Use --image <path> to specify an image or run interactively.`
    );
  }

  // Scan directories for image files
  const scanDirs = ['./test-assets', './images'];
  let allImages = [];

  for (const scanDir of scanDirs) {
    if (fs.existsSync(scanDir)) {
      const files = fs
        .readdirSync(scanDir)
        .filter((f) => /\.(jpg|jpeg|png|webp)$/i.test(f))
        .map((f) => ({ file: f, dir: scanDir, path: path.join(scanDir, f) }));
      allImages = allImages.concat(files);
    }
  }

  if (allImages.length === 0) {
    throw new Error(
      `No image files found in test-assets or images directories. Please place an image file there or use --image <path>.`
    );
  }

  console.log(`\n🖼️  Select ${label}:\n`);
  allImages.forEach((img, i) => {
    console.log(`  ${i + 1}. ${img.path}`);
  });
  console.log();

  const answer = await askQuestion(`Enter choice [1-${allImages.length}]: `);
  const choice = parseInt(answer, 10);

  if (isNaN(choice) || choice < 1 || choice > allImages.length) {
    // Default to first image
    console.log(`  → Using ${allImages[0].path}\n`);
    return allImages[0].path;
  }

  const selectedPath = allImages[choice - 1].path;
  console.log(`  → Using ${selectedPath}\n`);
  return selectedPath;
}

/**
 * Interactively pick an audio file from test-assets directory
 * @param {string|null} defaultAudio - Audio path provided via CLI
 * @param {string} label - Label for the audio type
 * @returns {Promise<string>} Selected audio path
 */
export async function pickAudioFile(defaultAudio = null, label = 'audio file') {
  // If audio was provided via CLI and exists, use it
  if (defaultAudio && fs.existsSync(defaultAudio)) {
    return defaultAudio;
  }

  // If not TTY, error out
  if (!process.stdin.isTTY) {
    throw new Error(
      `No ${label} found. Use --audio <path> to specify an audio file or run interactively.`
    );
  }

  // Scan test-assets for audio files
  const scanDir = './test-assets';
  if (!fs.existsSync(scanDir)) {
    throw new Error(`Directory ${scanDir} not found. Please create it and add audio files.`);
  }

  const audioFiles = fs
    .readdirSync(scanDir)
    .filter((f) => /\.(mp3|wav|m4a|ogg|flac)$/i.test(f))
    .sort();

  if (audioFiles.length === 0) {
    throw new Error(
      `No audio files found in ${scanDir}. Please add an audio file or use --audio <path>.`
    );
  }

  console.log(`\n🔊 Select ${label}:\n`);
  audioFiles.forEach((file, i) => {
    console.log(`  ${i + 1}. ${path.join(scanDir, file)}`);
  });
  console.log();

  const answer = await askQuestion(`Enter choice [1-${audioFiles.length}]: `);
  const choice = parseInt(answer, 10);

  if (isNaN(choice) || choice < 1 || choice > audioFiles.length) {
    // Default to first audio
    const defaultPath = path.join(scanDir, audioFiles[0]);
    console.log(`  → Using ${defaultPath}\n`);
    return defaultPath;
  }

  const selectedPath = path.join(scanDir, audioFiles[choice - 1]);
  console.log(`  → Using ${selectedPath}\n`);
  return selectedPath;
}

/**
 * Interactively pick a video file from test-assets directory
 * @param {string|null} defaultVideo - Video path provided via CLI
 * @param {string} label - Label for the video type
 * @returns {Promise<string>} Selected video path
 */
export async function pickVideoFile(defaultVideo = null, label = 'video file') {
  // If video was provided via CLI and exists, use it
  if (defaultVideo && fs.existsSync(defaultVideo)) {
    return defaultVideo;
  }

  // If not TTY, error out
  if (!process.stdin.isTTY) {
    throw new Error(
      `No ${label} found. Use --video <path> to specify a video file or run interactively.`
    );
  }

  // Scan test-assets for video files
  const scanDir = './test-assets';
  if (!fs.existsSync(scanDir)) {
    throw new Error(`Directory ${scanDir} not found. Please create it and add video files.`);
  }

  const videoFiles = fs
    .readdirSync(scanDir)
    .filter((f) => /\.(mp4|mov|avi|webm|mkv)$/i.test(f))
    .sort();

  if (videoFiles.length === 0) {
    throw new Error(
      `No video files found in ${scanDir}. Please add a video file or use --video <path>.`
    );
  }

  console.log(`\n🎬 Select ${label}:\n`);
  videoFiles.forEach((file, i) => {
    console.log(`  ${i + 1}. ${path.join(scanDir, file)}`);
  });
  console.log();

  const answer = await askQuestion(`Enter choice [1-${videoFiles.length}]: `);
  const choice = parseInt(answer, 10);

  if (isNaN(choice) || choice < 1 || choice > videoFiles.length) {
    // Default to first video
    const defaultPath = path.join(scanDir, videoFiles[0]);
    console.log(`  → Using ${defaultPath}\n`);
    return defaultPath;
  }

  const selectedPath = path.join(scanDir, videoFiles[choice - 1]);
  console.log(`  → Using ${selectedPath}\n`);
  return selectedPath;
}

/**
 * Display a numbered list of models and prompt user to select one
 * @param {Object} models - Object with model keys and model configs
 * @param {string} defaultKey - Default model key if user presses Enter
 * @returns {Promise<{key: string, config: Object}>} Selected model key and config
 */
export async function selectModel(models, defaultKey = null) {
  const modelKeys = Object.keys(models);
  const defaultIndex = defaultKey ? modelKeys.indexOf(defaultKey) + 1 : 1;

  console.log('\n📦 Select Model:\n');
  modelKeys.forEach((key, index) => {
    const model = models[key];
    const marker = defaultKey && key === defaultKey ? ' (default)' : '';
    console.log(`  ${index + 1}. ${model.name}${marker}`);
    if (model.description) {
      console.log(`     ${model.description}`);
    }
  });
  console.log();

  const choice = await askQuestion(
    `Enter choice [1-${modelKeys.length}] (default: ${defaultIndex}): `
  );
  const choiceNum = parseInt(choice.trim(), 10);

  if (choiceNum >= 1 && choiceNum <= modelKeys.length) {
    const key = modelKeys[choiceNum - 1];
    return { key, config: models[key] };
  }

  // Default selection
  const key = defaultKey || modelKeys[0];
  return { key, config: models[key] };
}

/**
 * Prompt for core options common to all workflows
 * @param {Object} options - Current options object
 * @param {Object} modelConfig - Selected model configuration
 * @param {Object} config - Additional configuration (defaultPrompt, isVideo, etc.)
 * @returns {Promise<Object>} Updated options
 */
export async function promptCoreOptions(options, modelConfig, config = {}) {
  const { defaultPrompt = '', isVideo = false } = config;

  // Prompt
  if (!options.prompt) {
    console.log();
    if (defaultPrompt) {
      console.log(
        `Default prompt: "${defaultPrompt.substring(0, 80)}${defaultPrompt.length > 80 ? '...' : ''}"`
      );
    }
    const promptInput = await askQuestion('Enter your prompt (or press Enter for default): ');
    options.prompt = promptInput.trim() || defaultPrompt;
  }

  // Width
  const defaultWidth =
    modelConfig.defaultWidth || (isVideo ? VIDEO_CONSTRAINTS.width.default : 1024);
  const widthRange = isVideo
    ? ` (${VIDEO_CONSTRAINTS.width.min}-${VIDEO_CONSTRAINTS.width.max})`
    : '';
  const widthInput = await askQuestion(`Width${widthRange} (default: ${defaultWidth}): `);
  if (widthInput.trim()) {
    const w = parseInt(widthInput.trim(), 10);
    if (!isNaN(w) && w > 0) {
      options.width = isVideo
        ? Math.max(VIDEO_CONSTRAINTS.width.min, Math.min(VIDEO_CONSTRAINTS.width.max, w))
        : w;
    }
  }
  if (!options.width) options.width = defaultWidth;

  // Height
  const defaultHeight =
    modelConfig.defaultHeight || (isVideo ? VIDEO_CONSTRAINTS.height.default : 1024);
  const heightRange = isVideo
    ? ` (${VIDEO_CONSTRAINTS.height.min}-${VIDEO_CONSTRAINTS.height.max})`
    : '';
  const heightInput = await askQuestion(`Height${heightRange} (default: ${defaultHeight}): `);
  if (heightInput.trim()) {
    const h = parseInt(heightInput.trim(), 10);
    if (!isNaN(h) && h > 0) {
      options.height = isVideo
        ? Math.max(VIDEO_CONSTRAINTS.height.min, Math.min(VIDEO_CONSTRAINTS.height.max, h))
        : h;
    }
  }
  if (!options.height) options.height = defaultHeight;

  return options;
}

/**
 * Prompt for video-specific duration
 * @param {Object} options - Current options object
 * @param {Object} modelConfig - Selected model configuration (optional)
 * @returns {Promise<Object>} Updated options with frames calculated
 */
export async function promptVideoDuration(options, modelConfig = {}) {
  const fps = options.fps || VIDEO_CONSTRAINTS.fps.default;

  // Use model-specific frame limits if available
  const maxFrames = modelConfig.maxFrames || VIDEO_CONSTRAINTS.frames.max;
  const defaultFrames = modelConfig.defaultFrames || VIDEO_CONSTRAINTS.frames.default;
  const minFrames = VIDEO_CONSTRAINTS.frames.min;

  // Calculate duration from default frames
  const defaultDuration = ((defaultFrames - 1) / fps).toFixed(1);
  const minDuration = ((minFrames - 1) / fps).toFixed(1);
  const maxDuration = ((maxFrames - 1) / fps).toFixed(1);

  console.log();
  const durationInput = await askQuestion(
    `Duration in seconds (${minDuration}-${maxDuration}s, default: ${defaultDuration}): `
  );
  let duration = parseFloat(defaultDuration);
  if (durationInput.trim()) {
    const d = parseFloat(durationInput.trim());
    if (!isNaN(d) && d > 0) {
      duration = d;
    }
  }

  // Convert duration to frames: frames = (seconds * fps) + 1
  let frames = Math.round(duration * fps) + 1;
  frames = Math.max(minFrames, Math.min(maxFrames, frames));
  options.frames = frames;
  options.duration = (frames - 1) / fps; // Store actual duration

  return options;
}

/**
 * Prompt for advanced options
 * @param {Object} options - Current options object
 * @param {Object} modelConfig - Selected model configuration
 * @param {Object} config - Additional configuration (isVideo, etc.)
 * @returns {Promise<Object>} Updated options
 */
export async function promptAdvancedOptions(options, modelConfig, config = {}) {
  const { isVideo = false } = config;

  console.log('\n🔧 Advanced Options\n');

  // Video-specific advanced options
  if (isVideo) {
    // FPS
    console.log('  FPS options: 16 (native), 32 (interpolated)');
    const fpsInput = await askQuestion('  FPS (default: 16): ');
    if (fpsInput.trim()) {
      const f = parseInt(fpsInput.trim(), 10);
      if (f === 16 || f === 32) {
        options.fps = f;
      }
    }
    if (!options.fps) options.fps = 16;

    // Shift
    const defaultShift = modelConfig.defaultShift || VIDEO_CONSTRAINTS.shift.default;
    const shiftInput = await askQuestion(
      `  Shift (motion intensity, ${VIDEO_CONSTRAINTS.shift.min}-${VIDEO_CONSTRAINTS.shift.max}, default: ${defaultShift}): `
    );
    if (shiftInput.trim()) {
      const s = parseFloat(shiftInput.trim());
      if (s >= VIDEO_CONSTRAINTS.shift.min && s <= VIDEO_CONSTRAINTS.shift.max) {
        options.shift = s;
      }
    }
    if (options.shift === undefined) options.shift = defaultShift;
  }

  // Guidance (if supported by model)
  if (modelConfig.supportsGuidance !== false) {
    // Use model-specific guidance ranges
    const defaultGuidance = modelConfig.defaultGuidance || 4.0;
    const minGuidance = modelConfig.minGuidance || 1.5;
    const maxGuidance = modelConfig.maxGuidance || 8.0;
    const guidanceInput = await askQuestion(
      `Guidance scale (${minGuidance}-${maxGuidance}, default: ${defaultGuidance}): `
    );
    if (guidanceInput.trim()) {
      const g = parseFloat(guidanceInput.trim());
      if (!isNaN(g) && g >= minGuidance && g <= maxGuidance) {
        options.guidance = g;
      } else if (!isNaN(g)) {
        // Clamp to valid range
        options.guidance = Math.max(minGuidance, Math.min(maxGuidance, g));
        console.log(`    (clamped to ${options.guidance})`);
      }
    }
    if (options.guidance === undefined) options.guidance = defaultGuidance;
  }

  // Sampler - use sampler for ComfyUI models, sampler for legacy models
  const isComfyModel = modelConfig.isComfyModel;
  const defaultSampler = modelConfig.defaultComfySampler || modelConfig.defaultSampler || 'euler';
  const defaultSamplerIdx = COMFY_SAMPLERS.findIndex((s) => s.id === defaultSampler) + 1;
  const defaultSamplerName = COMFY_SAMPLERS.find((s) => s.id === defaultSampler)?.name || 'Euler';
  console.log('\n  Samplers:');
  COMFY_SAMPLERS.forEach((s, i) => {
    const marker = s.id === defaultSampler ? ' (recommended)' : '';
    console.log(`    ${i + 1}. ${s.name} - ${s.description}${marker}`);
  });
  const samplerInput = await askQuestion(
    `  Select sampler (default: ${defaultSamplerIdx} - ${defaultSamplerName}): `
  );
  if (samplerInput.trim()) {
    const idx = parseInt(samplerInput.trim(), 10) - 1;
    if (idx >= 0 && idx < COMFY_SAMPLERS.length) {
      if (isComfyModel) {
        options.sampler = COMFY_SAMPLERS[idx].id;
      } else {
        options.sampler = COMFY_SAMPLERS[idx].id;
      }
    }
  }
  // Set default if not selected
  if (isComfyModel && !options.sampler) {
    options.sampler = defaultSampler;
  } else if (!isComfyModel && !options.sampler) {
    options.sampler = defaultSampler;
  }

  // Scheduler - use scheduler for ComfyUI models, scheduler for legacy models
  const defaultScheduler =
    modelConfig.defaultComfyScheduler || modelConfig.defaultScheduler || 'simple';
  const defaultSchedulerIdx = COMFY_SCHEDULERS.findIndex((s) => s.id === defaultScheduler) + 1;
  const defaultSchedulerName =
    COMFY_SCHEDULERS.find((s) => s.id === defaultScheduler)?.name || 'Simple';
  console.log('\n  Schedulers:');
  COMFY_SCHEDULERS.forEach((s, i) => {
    const marker = s.id === defaultScheduler ? ' (recommended)' : '';
    console.log(`    ${i + 1}. ${s.name} - ${s.description}${marker}`);
  });
  const schedulerInput = await askQuestion(
    `  Select scheduler (default: ${defaultSchedulerIdx} - ${defaultSchedulerName}): `
  );
  if (schedulerInput.trim()) {
    const idx = parseInt(schedulerInput.trim(), 10) - 1;
    if (idx >= 0 && idx < COMFY_SCHEDULERS.length) {
      if (isComfyModel) {
        options.scheduler = COMFY_SCHEDULERS[idx].id;
      } else {
        options.scheduler = COMFY_SCHEDULERS[idx].id;
      }
    }
  }
  // Set default if not selected
  if (isComfyModel && !options.scheduler) {
    options.scheduler = defaultScheduler;
  } else if (!isComfyModel && !options.scheduler) {
    options.scheduler = defaultScheduler;
  }

  // Negative prompt
  const negativeInput = await askQuestion('\nNegative prompt (optional): ');
  if (negativeInput.trim()) {
    options.negative = negativeInput.trim();
  }

  // Seed
  console.log('\n  Seed (-1 for random, or specify a number for reproducible results)');
  const seedInput = await askQuestion('  Seed (default: -1): ');
  if (seedInput.trim()) {
    const seed = parseInt(seedInput.trim(), 10);
    if (!isNaN(seed)) {
      options.seed = seed;
    }
  }
  if (options.seed === undefined || options.seed === null) options.seed = -1;

  // Batch count (number of images or videos to generate)
  const maxBatch = isVideo ? 4 : 16;
  const mediaType = isVideo ? 'videos' : 'images';
  const batchInput = await askQuestion(
    `\n  Number of ${mediaType} to generate (1-${maxBatch}, default: 1): `
  );
  if (batchInput.trim()) {
    const b = parseInt(batchInput.trim(), 10);
    if (b >= 1 && b <= maxBatch) {
      options.batch = b;
    }
  }
  if (!options.batch) options.batch = 1;

  // Output format (image workflows only)
  if (!isVideo) {
    console.log('\n  Output Format:');
    console.log('    1. JPG - smaller files, lossy (default)');
    console.log('    2. PNG - larger files, lossless');
    const formatInput = await askQuestion('  Select output format (default: 1 - JPG): ');
    if (formatInput.trim() === '2' || formatInput.trim().toLowerCase() === 'png') {
      options.outputFormat = 'png';
    } else {
      options.outputFormat = 'jpg';
    }
  }

  return options;
}

/**
 * Prompt for S2V-specific options (audio start, duration)
 * @param {Object} options - Current options object
 * @param {number} audioDuration - Detected audio duration in seconds
 * @returns {Promise<Object>} Updated options
 */
export async function promptS2VOptions(options, audioDuration) {
  console.log('\n🎵 Sound-to-Video Options\n');
  console.log(`  Detected audio duration: ${audioDuration.toFixed(1)}s`);

  // Audio start position
  const audioStartInput = await askQuestion(
    `  Audio start position in seconds (0-${audioDuration.toFixed(1)}s, default: 0): `
  );
  if (audioStartInput.trim()) {
    const s = parseFloat(audioStartInput.trim());
    if (!isNaN(s) && s >= 0 && s < audioDuration) {
      options.audioStart = s;
    }
  }
  if (options.audioStart === undefined) options.audioStart = 0;

  // Audio duration (how much of the audio to use)
  const maxAudioDuration = audioDuration - options.audioStart;
  const audioLengthInput = await askQuestion(
    `  Audio duration to use (0-${maxAudioDuration.toFixed(1)}s, default: auto from video length): `
  );
  if (audioLengthInput.trim()) {
    const d = parseFloat(audioLengthInput.trim());
    if (!isNaN(d) && d > 0 && d <= maxAudioDuration) {
      options.audioDuration = d;
    }
  }

  return options;
}

/**
 * Prompt for animate-replace specific options (SAM2 coordinates)
 * @param {Object} options - Current options object
 * @returns {Promise<Object>} Updated options
 */
export async function promptAnimateReplaceOptions(options) {
  console.log('\n🎯 Subject Selection (SAM2 Coordinates)\n');
  console.log('  Click coordinates tell SAM2 which subject to replace.');
  console.log('  Format: x,y pairs relative to image (e.g., "0.5,0.5" for center)');

  const coordsInput = await askQuestion('  Subject coordinates (default: 0.5,0.5 - center): ');
  if (coordsInput.trim()) {
    const parts = coordsInput.trim().split(',');
    if (parts.length >= 2) {
      const x = parseFloat(parts[0]);
      const y = parseFloat(parts[1]);
      if (!isNaN(x) && !isNaN(y) && x >= 0 && y >= 0) {
        options.sam2Coordinates = JSON.stringify([{ x, y }]);
      }
    }
  }
  if (!options.sam2Coordinates) {
    options.sam2Coordinates = JSON.stringify([{ x: 0.5, y: 0.5 }]);
  }

  return options;
}

/**
 * Prompt for context images (Flux.2 Dev, Qwen Image Edit)
 * @param {Object} options - Current options object
 * @param {number} maxImages - Maximum number of context images supported
 * @returns {Promise<Object>} Updated options
 */
export async function promptContextImages(options, maxImages = 3) {
  console.log(`\n📸 Context/Reference Images (up to ${maxImages})\n`);
  console.log('  These provide additional style or content reference for the generation.');

  options.contextImages = options.contextImages || [];

  for (let i = 0; i < maxImages; i++) {
    const ordinal = i === 0 ? '1st' : i === 1 ? '2nd' : '3rd';
    const addMore = await askQuestion(`\n  Add ${ordinal} context image? [y/N]: `);

    if (addMore.toLowerCase() !== 'y' && addMore.toLowerCase() !== 'yes') {
      break;
    }

    try {
      const imagePath = await pickImageFile(null, `context image ${i + 1}`);
      options.contextImages.push(imagePath);
      log('✓', `Added context image ${i + 1}: ${imagePath}`);
    } catch (error) {
      log('⚠️', `Could not add context image: ${error.message}`);
      break;
    }
  }

  return options;
}

/**
 * Log helper function with icon
 */
export function log(icon, message) {
  console.log(`${icon} ${message}`);
}

/**
 * Format duration as mm:ss
 */
export function formatDuration(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Display configuration summary
 */
export function displayConfig(title, config) {
  const boxInnerWidth = 58;
  const labelWidth = 16;
  const valueWidth = boxInnerWidth - labelWidth;

  console.log();
  console.log('┌' + '─'.repeat(boxInnerWidth) + '┐');
  console.log('│ ' + title.padEnd(boxInnerWidth - 2) + ' │');
  console.log('├' + '─'.repeat(boxInnerWidth) + '┤');

  for (const [label, value] of Object.entries(config)) {
    if (value !== undefined && value !== null && value !== '') {
      const labelStr = (label + ':').padEnd(labelWidth);
      const valueStr = String(value);

      // For longer values (like prompts), wrap them
      if (valueStr.length > valueWidth - 2) {
        // First line with label
        const firstChunk = valueStr.substring(0, valueWidth - 2);
        console.log('│ ' + labelStr + ' ' + firstChunk.padEnd(valueWidth - 3) + ' │');
        // Continuation lines
        let remaining = valueStr.substring(valueWidth - 2);
        while (remaining.length > 0) {
          const chunk = remaining.substring(0, valueWidth - 2);
          console.log('│ ' + ' '.repeat(labelWidth) + ' ' + chunk.padEnd(valueWidth - 3) + ' │');
          remaining = remaining.substring(valueWidth - 2);
        }
      } else {
        console.log('│ ' + labelStr + ' ' + valueStr.padEnd(valueWidth - 3) + ' │');
      }
    }
  }

  console.log('└' + '─'.repeat(boxInnerWidth) + '┘');
}

/**
 * Display prompts summary
 */
export function displayPrompts(prompts) {
  console.log();
  console.log('📝 Prompts:');
  if (prompts.positive) {
    const truncated =
      prompts.positive.length > 100 ? prompts.positive.substring(0, 100) + '...' : prompts.positive;
    console.log(`   Positive: ${truncated}`);
  }
  if (prompts.negative) {
    console.log(`   Negative: ${prompts.negative}`);
  }
  if (prompts.style) {
    console.log(`   Style: ${prompts.style}`);
  }
  console.log();
}

// ============================================
// File Reading for SDK Upload
// ============================================

/**
 * Read a file from disk as a Blob for SDK upload.
 * The SDK requires File/Buffer/Blob objects, NOT string paths.
 * Passing a string path will silently fail and corrupt the upload.
 *
 * NOTE: We return a Blob because the SDK's toFetchBody() function
 * explicitly handles File, Buffer, and Blob types. Uint8Array is NOT
 * handled and will fail silently.
 *
 * @param {string} filePath - Path to the file
 * @returns {Blob} File contents as a Blob
 */
export function readFileAsBuffer(filePath) {
  if (!filePath) {
    throw new Error('File path is required');
  }
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  // Read file as Buffer
  const buffer = fs.readFileSync(filePath);

  // CRITICAL: Node.js Buffer may be backed by a pooled ArrayBuffer.
  // We must slice to get ONLY our file's data, not the entire pool.
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

  // Return as Blob - this is what the SDK's toFetchBody() expects
  return new Blob([arrayBuffer]);
}

/**
 * Read multiple files from disk as Uint8Arrays for SDK upload.
 *
 * @param {string[]} filePaths - Array of file paths
 * @returns {Uint8Array[]} Array of file contents as Uint8Arrays
 */
export function readFilesAsBuffers(filePaths) {
  return filePaths.filter(Boolean).map(readFileAsBuffer);
}
