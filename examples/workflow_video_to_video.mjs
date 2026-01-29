#!/usr/bin/env node
/**
 * Video-to-Video Workflow
 *
 * This script generates videos using two model families:
 *
 * WAN Animate Models (require reference image + source video):
 * - animate-move: Camera movement animation (pans, zooms, etc.)
 * - animate-replace: Replace subjects in the source video with the reference image
 *
 * LTX-2 V2V ControlNet Models (with control type selection):
 * - canny: Edge detection-based control (video only)
 * - pose: Skeleton/pose-based control (optional image for appearance + video for motion)
 * - depth: Depth map control (video only)
 * - detailer: Quality enhancement (video only)
 *
 * Prerequisites:
 * - Set SOGNI_USERNAME and SOGNI_PASSWORD in .env file (or will prompt)
 * - You need access to the 'fast' network for video generation
 *
 * Usage:
 *   # WAN Animate (requires image + video)
 *   node workflow_video_to_video.mjs --image person.jpg --video motion.mp4
 *   node workflow_video_to_video.mjs "Dancing character" --image char.jpg --video dance.mp4
 *
 *   # LTX-2 V2V ControlNet
 *   node workflow_video_to_video.mjs --video source.mp4 --model ltx2-v2v-distilled --control-type canny
 *   node workflow_video_to_video.mjs "A dancing figure" --video dance.mp4 --control-type pose
 *   node workflow_video_to_video.mjs "A robot" --image robot.jpg --video dance.mp4 --control-type pose
 *
 * Options:
 *   --image       Reference image path (required for WAN animate, optional for pose)
 *   --video       Source video path (required)
 *   --model       Model to use (see available models below)
 *   --control-type Control type for LTX-2 V2V: canny, pose, depth, detailer
 *   --sam2-coords SAM2 click coordinates for subject detection (animate-replace only)
 *                 Format: "x,y" where x,y are normalized 0-1 coordinates
 *   --video-start Video start position in seconds (where to begin reading from source video)
 *   --width       Video width (LTX-2: auto from source video, aligned to 64, min 768)
 *   --height      Video height (LTX-2: auto from source video, aligned to 64, min 768)
 *   --duration    Duration in seconds (default: 5, converts to frames)
 *   --fps         Frames per second (default: model-specific)
 *   --batch       Number of videos to generate (default: 1)
 *   --seed        Random seed for reproducibility (default: -1 for random)
 *   --guidance    Guidance scale (default: model-specific)
 *   --shift       Motion intensity 1.0-8.0 (default: 8.0, WAN only)
 *   --strength    Guide strength 0.5-1.0 (default: 0.85, LTX-2 only)
 *   --comfy-sampler  ComfyUI sampler name (default: euler)
 *   --comfy-scheduler ComfyUI scheduler name (default: simple)
 *   --negative    Negative prompt (default: none)
 *   --style       Style prompt (default: none)
 *   --output      Output directory (default: ./output)
 *   --no-interactive  Skip interactive prompts
 *   --help        Show this help message
 */

import { SogniClient } from '../dist/index.js';
import * as fs from 'node:fs';
import { pipeline } from 'node:stream';
import { promisify } from 'node:util';
import { exec } from 'node:child_process';
import imageSize from 'image-size';
import {
  loadCredentials,
  loadTokenTypePreference,
  saveTokenTypePreference
} from './credentials.mjs';
import {
  MODELS,
  VIDEO_CONSTRAINTS,
  CONTROL_NET_TYPES,
  askQuestion,
  selectModel,
  promptCoreOptions,
  promptVideoFps,
  promptVideoDuration,
  promptAdvancedOptions,
  promptBatchCount,
  promptAnimateReplaceOptions,
  promptControlNetType,
  pickImageFile,
  pickVideoFile,
  readFileAsBuffer,
  processImageForVideo,
  getVideoDuration,
  getVideoDimensions,
  getVideoFps,
  log,
  formatDuration,
  displayConfig,
  displayPrompts,
  getUniqueFilename,
  generateVideoFilename,
  generateRandomSeed
} from './workflow-helpers.mjs';

const streamPipeline = promisify(pipeline);

// Default prompt for this workflow (matches the default test video)
const DEFAULT_PROMPT =
  'a ballerina wearing a pink tutu pirouettes at the bottom of a pool with sparkling dappled sunlight coming through the water, her face is covered by a snorkel mask. Background music is a soothing violin melody.';

// Video dimension constraints
const MAX_VIDEO_DIMENSION = 1536;

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
    video: null,
    controlNetType: null,
    sam2Coordinates: null,
    videoStart: null,
    modelKey: null,
    width: null,
    height: null,
    duration: null,
    fps: null,
    frames: null,
    batch: 1,
    seed: null,
    guidance: null,
    shift: null,
    strength: null,
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
    } else if (arg === '--video' && args[i + 1]) {
      options.video = args[++i];
    } else if (arg === '--control-type' && args[i + 1]) {
      options.controlNetType = args[++i];
    } else if (arg === '--strength' && args[i + 1]) {
      options.strength = parseFloat(args[++i]);
    } else if (arg === '--sam2-coords' && args[i + 1]) {
      options.sam2Coordinates = args[++i];
    } else if (arg === '--video-start' && args[i + 1]) {
      options.videoStart = parseFloat(args[++i]);
    } else if (arg === '--model' && args[i + 1]) {
      options.modelKey = args[++i];
    } else if (arg === '--width' && args[i + 1]) {
      options.width = parseInt(args[++i], 10);
    } else if (arg === '--height' && args[i + 1]) {
      options.height = parseInt(args[++i], 10);
    } else if (arg === '--duration' && args[i + 1]) {
      options.duration = parseFloat(args[++i]);
    } else if (arg === '--fps' && args[i + 1]) {
      options.fps = parseInt(args[++i], 10);
    } else if (arg === '--frames' && args[i + 1]) {
      options.frames = parseInt(args[++i], 10);
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
    } else if (arg === '--shift' && args[i + 1]) {
      options.shift = parseFloat(args[++i]);
    } else if (arg === '--comfy-sampler' && args[i + 1]) {
      options.sampler = args[++i];
    } else if (arg === '--comfy-scheduler' && args[i + 1]) {
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
Video-to-Video Workflow

Usage:
  # WAN Animate (requires image + video)
  node workflow_video_to_video.mjs --image person.jpg --video motion.mp4
  node workflow_video_to_video.mjs "Dancing character" --image char.jpg --video dance.mp4

  # LTX-2 V2V ControlNet (video only)
  node workflow_video_to_video.mjs --video source.mp4 --model ltx2-v2v-distilled --control-type canny

Available Models:
  LTX-2 V2V ControlNet (video only, with audio):
    ltx2-v2v-distilled - LTX-2 V2V ControlNet Fast (8-step, recommended)
    ltx2-v2v           - LTX-2 V2V ControlNet Quality (20-step)

  WAN Animate (requires reference image + video):
    move-lightx2v      - WAN 2.2 14B Animate-Move LightX2V (camera movement)
    replace-lightx2v   - WAN 2.2 14B Animate-Replace LightX2V (subject replacement)

Control Types (LTX-2 V2V only):
    canny    - Edge detection (preserves outlines, video only)
    pose     - Skeleton control (optional image for appearance + video for motion)
    depth    - Depth map control (preserves spatial relationships, video only)
    detailer - Quality enhancement (no preprocessing, video only)

Options:
  --video         Source video path (required)
  --image         Reference image path (required for WAN animate, optional for pose)
  --model         Model key (see available models above)
  --control-type  Control type for LTX-2 V2V: canny, pose, depth, detailer
  --sam2-coords   SAM2 click coordinates for animate-replace (format: "x,y", 0-1 normalized)
  --video-start   Video start position in seconds (default: 0)
  --negative      Negative prompt (default: none)
  --style         Style prompt (default: none)
  --width         Video width (LTX-2: auto from source, aligned to 64, min 768)
  --height        Video height (LTX-2: auto from source, aligned to 64, min 768)
  --duration      Duration in seconds (default: 5)
  --fps           Frames per second (default: model-specific)
  --batch         Number of videos to generate (default: 1)
  --seed          Random seed (default: -1 for random)
  --guidance      Guidance scale (default: model-specific)
  --shift         Motion intensity 1.0-8.0 (WAN only, default: 8.0)
  --strength      Guide strength 0.5-1.0 (LTX-2 only, default: 0.85)
  --comfy-sampler   ComfyUI sampler name (default: euler)
  --comfy-scheduler ComfyUI scheduler name (default: simple)
  --output        Output directory (default: ./output)
  --no-interactive  Skip interactive prompts
  --help          Show this help message

Examples:
  # LTX-2 V2V with canny control (fast)
  node workflow_video_to_video.mjs --video dance.mp4 --model ltx2-v2v-distilled --control-type canny

  # LTX-2 V2V with pose control (requires image for appearance)
  node workflow_video_to_video.mjs "A robot dancing" --image robot.jpg --video dance.mp4 --control-type pose

  # WAN animate-move with reference image
  node workflow_video_to_video.mjs --image portrait.jpg --video camera_motion.mp4 --model move-lightx2v

  # WAN animate-replace with subject selection
  node workflow_video_to_video.mjs --image new_face.jpg --video original.mp4 --model replace-lightx2v
`);
}

// ============================================
// Utility Functions
// ============================================

/**
 * Ensure dimensions are even
 */
function ensureEvenDimensions(width, height) {
  return {
    width: width % 2 === 0 ? width : width - 1,
    height: height % 2 === 0 ? height : height - 1
  };
}

/**
 * Parse SAM2 coordinates from string
 */
function parseSam2Coordinates(coordsStr) {
  if (!coordsStr) return null;

  const parts = coordsStr.split(',');
  if (parts.length < 2) {
    throw new Error('SAM2 coordinates must be in format "x,y"');
  }

  const x = parseFloat(parts[0]);
  const y = parseFloat(parts[1]);

  if (isNaN(x) || isNaN(y)) {
    throw new Error('SAM2 coordinates must be valid numbers');
  }

  if (x < 0 || x > 1 || y < 0 || y > 1) {
    throw new Error('SAM2 coordinates must be between 0 and 1');
  }

  return JSON.stringify([{ x, y }]);
}

// ============================================
// Main Logic
// ============================================

async function main() {
  const OPTIONS = await parseArgs();

  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║              Video-to-Video Workflow                     ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log();

  // Load credentials
  const { username: USERNAME, password: PASSWORD } = await loadCredentials();

  // Interactive mode: select model first to know if we need a reference image
  let modelConfig;
  if (OPTIONS.interactive && !OPTIONS.modelKey) {
    const selection = await selectModel(MODELS.animate, 'ltx2-v2v-distilled');
    OPTIONS.modelKey = selection.key;
    modelConfig = selection.config;
  } else {
    OPTIONS.modelKey = OPTIONS.modelKey || 'ltx2-v2v-distilled';
    modelConfig = MODELS.animate[OPTIONS.modelKey];
    if (!modelConfig) {
      const availableModels = Object.keys(MODELS.animate).join(', ');
      console.error(
        `Error: Unknown model '${OPTIONS.modelKey}'. Available: ${availableModels}`
      );
      process.exit(1);
    }
  }

  log('🎬', `Selected model: ${modelConfig.name}`);
  log('🎬', `Workflow type: ${modelConfig.workflowType}`);

  // LTX-2 V2V: Select control type FIRST (before determining image requirement)
  if (modelConfig.supportsControlNet) {
    if (OPTIONS.interactive && !OPTIONS.controlNetType) {
      await promptControlNetType(OPTIONS, modelConfig);
    } else if (!OPTIONS.controlNetType) {
      OPTIONS.controlNetType = modelConfig.controlNetTypes[0]; // Default to first (canny)
    }

    // Validate control type
    if (!modelConfig.controlNetTypes.includes(OPTIONS.controlNetType)) {
      console.error(`Error: Invalid control type '${OPTIONS.controlNetType}'. Use one of: ${modelConfig.controlNetTypes.join(', ')}`);
      process.exit(1);
    }

    log('🎛️', `Control type: ${CONTROL_NET_TYPES[OPTIONS.controlNetType].name}`);
  }

  // Determine if this model requires a reference image
  // WAN animate models always require a reference image
  // LTX-2 V2V control types (canny, depth, detailer, pose) - image is optional for pose
  let requiresImage = modelConfig.requiresReferenceImage !== false;
  let imageOptional = false;

  // For LTX-2 V2V with pose control, reference image is optional
  // If provided: appearance comes from reference image
  // If not provided: generates from prompt with only pose control
  if (modelConfig.supportsControlNet && OPTIONS.controlNetType === 'pose') {
    requiresImage = false;
    imageOptional = true;
    log('📸', 'Pose control: reference image is optional (provides appearance if specified)');
  }

  // Interactive mode: get image path if required, or offer if optional
  if (requiresImage) {
    if (OPTIONS.interactive && !OPTIONS.image) {
      OPTIONS.image = await pickImageFile(null, 'reference image (appearance)');
    }
  } else if (imageOptional && OPTIONS.interactive && !OPTIONS.image) {
    const useImage = await askQuestion('Would you like to provide a reference image for appearance? [y/N]: ');
    if (useImage.toLowerCase() === 'y' || useImage.toLowerCase() === 'yes') {
      OPTIONS.image = await pickImageFile(null, 'reference image (optional - for appearance)');
    }
  }

  // Interactive mode: get video path if not provided
  if (OPTIONS.interactive && !OPTIONS.video) {
    OPTIONS.video = await pickVideoFile(null, 'source video (motion)');
  }

  // Validate required inputs
  if (requiresImage) {
    if (!OPTIONS.image) {
      console.error('Error: Reference image is required for this model/control type (use --image option)');
      process.exit(1);
    }
    if (!fs.existsSync(OPTIONS.image)) {
      console.error(`Error: Reference image '${OPTIONS.image}' does not exist`);
      process.exit(1);
    }
  } else if (OPTIONS.image && !fs.existsSync(OPTIONS.image)) {
    console.error(`Error: Reference image '${OPTIONS.image}' does not exist`);
    process.exit(1);
  }

  if (!OPTIONS.video) {
    console.error('Error: Source video is required (use --video option)');
    process.exit(1);
  }
  if (!fs.existsSync(OPTIONS.video)) {
    console.error(`Error: Source video '${OPTIONS.video}' does not exist`);
    process.exit(1);
  }

  // Get image dimensions if we have a reference image
  let imageInfo = { width: modelConfig.defaultWidth || 832, height: modelConfig.defaultHeight || 480 };
  if (requiresImage && OPTIONS.image) {
    try {
      const dimensions = imageSize(OPTIONS.image);
      if (dimensions.width && dimensions.height) {
        imageInfo = { width: dimensions.width, height: dimensions.height };
      }
      log('📐', `Image dimensions: ${imageInfo.width}x${imageInfo.height}`);
    } catch (error) {
      log('⚠️', 'Could not read image dimensions, using defaults');
    }
  }

  // For LTX-2 V2V, auto-detect source video duration, dimensions, and FPS
  let sourceVideoDuration = null;
  let sourceVideoDimensions = null;
  let sourceVideoFps = null;
  if (modelConfig.supportsControlNet && OPTIONS.video) {
    log('🎬', 'Analyzing source video...');
    [sourceVideoDuration, sourceVideoDimensions, sourceVideoFps] = await Promise.all([
      getVideoDuration(OPTIONS.video),
      getVideoDimensions(OPTIONS.video),
      getVideoFps(OPTIONS.video)
    ]);
    if (sourceVideoDuration !== null) {
      log('🎬', `Source video duration: ${sourceVideoDuration.toFixed(1)}s`);
    }
    if (sourceVideoDimensions !== null) {
      log('📐', `Source video dimensions: ${sourceVideoDimensions.width}x${sourceVideoDimensions.height}`);
    }
    if (sourceVideoFps !== null) {
      log('🎞️', `Source video FPS: ${sourceVideoFps}`);
      // Use source FPS (rounded to nearest supported rate) as suggested default
      if (modelConfig.minFps !== undefined && modelConfig.maxFps !== undefined) {
        // Clamp to model's FPS range
        const clampedFps = Math.max(modelConfig.minFps, Math.min(modelConfig.maxFps, sourceVideoFps));
        modelConfig.defaultFps = clampedFps;
      } else if (modelConfig.allowedFps) {
        if (modelConfig.allowedFps.includes(sourceVideoFps)) {
          modelConfig.defaultFps = sourceVideoFps;
        } else {
          // Find the nearest allowed FPS
          const nearestFps = modelConfig.allowedFps.reduce((prev, curr) =>
            Math.abs(curr - sourceVideoFps) < Math.abs(prev - sourceVideoFps) ? curr : prev
          );
          modelConfig.defaultFps = nearestFps;
        }
      } else {
        // No constraints, use source FPS directly
        modelConfig.defaultFps = sourceVideoFps;
      }
    } else {
      // Fallback to 24 fps if detection fails
      log('🎞️', `Could not detect source FPS, defaulting to 24`);
      modelConfig.defaultFps = 24;
    }
  }

  // Set default dimensions from image (if available) or use model defaults
  if (requiresImage) {
    modelConfig.defaultWidth = imageInfo.width;
    modelConfig.defaultHeight = imageInfo.height;
  }

  // For LTX-2 V2V, calculate recommended dimensions from source video
  // Scale proportionally to maintain aspect ratio, then align to step size
  let recommendedWidth = modelConfig.defaultWidth;
  let recommendedHeight = modelConfig.defaultHeight;
  if (modelConfig.supportsControlNet && sourceVideoDimensions) {
    const dimStep = modelConfig.dimensionStep || 64;
    const minWidth = modelConfig.minWidth || 768;
    const minHeight = modelConfig.minHeight || 768;
    const maxWidth = modelConfig.maxWidth || 3840;
    const maxHeight = modelConfig.maxHeight || 3840;

    // Start with source dimensions
    let targetWidth = sourceVideoDimensions.width;
    let targetHeight = sourceVideoDimensions.height;
    const aspectRatio = sourceVideoDimensions.width / sourceVideoDimensions.height;

    // Scale up proportionally if below minimums
    if (targetWidth < minWidth || targetHeight < minHeight) {
      const scaleForWidth = minWidth / targetWidth;
      const scaleForHeight = minHeight / targetHeight;
      const scale = Math.max(scaleForWidth, scaleForHeight);
      targetWidth = Math.round(targetWidth * scale);
      targetHeight = Math.round(targetHeight * scale);
    }

    // Scale down proportionally if above maximums
    if (targetWidth > maxWidth || targetHeight > maxHeight) {
      const scaleForWidth = maxWidth / targetWidth;
      const scaleForHeight = maxHeight / targetHeight;
      const scale = Math.min(scaleForWidth, scaleForHeight);
      targetWidth = Math.round(targetWidth * scale);
      targetHeight = Math.round(targetHeight * scale);
    }

    // Align to step size while maintaining aspect ratio as closely as possible
    // Round width to step, then calculate height to maintain aspect ratio
    let alignedWidth = Math.round(targetWidth / dimStep) * dimStep;
    let alignedHeight = Math.round(alignedWidth / aspectRatio / dimStep) * dimStep;

    // Ensure we still meet minimums after alignment (step rounding can push below)
    if (alignedWidth < minWidth) alignedWidth = minWidth;
    if (alignedHeight < minHeight) {
      alignedHeight = minHeight;
      // Recalculate width to maintain aspect ratio
      alignedWidth = Math.round(alignedHeight * aspectRatio / dimStep) * dimStep;
      if (alignedWidth < minWidth) alignedWidth = minWidth;
    }

    // Ensure we don't exceed maximums
    if (alignedWidth > maxWidth) alignedWidth = maxWidth;
    if (alignedHeight > maxHeight) alignedHeight = maxHeight;

    recommendedWidth = alignedWidth;
    recommendedHeight = alignedHeight;

    // Log the recommendation
    const sourceRatio = (sourceVideoDimensions.width / sourceVideoDimensions.height).toFixed(2);
    const targetRatio = (recommendedWidth / recommendedHeight).toFixed(2);
    if (sourceVideoDimensions.width < minWidth || sourceVideoDimensions.height < minHeight) {
      log('📐', `Recommended: ${recommendedWidth}x${recommendedHeight} (scaled from ${sourceVideoDimensions.width}x${sourceVideoDimensions.height}, ratio ${sourceRatio}→${targetRatio})`);
    } else {
      log('📐', `Recommended: ${recommendedWidth}x${recommendedHeight} (ratio ${sourceRatio}→${targetRatio})`);
    }

    // Update model defaults for prompts
    modelConfig.defaultWidth = recommendedWidth;
    modelConfig.defaultHeight = recommendedHeight;
  }

  // Interactive mode: prompt for options
  if (OPTIONS.interactive) {
    // Pass source aspect ratio so height can auto-adjust when user changes width
    const sourceAspectRatio = sourceVideoDimensions
      ? sourceVideoDimensions.width / sourceVideoDimensions.height
      : null;
    await promptCoreOptions(OPTIONS, modelConfig, {
      defaultPrompt: DEFAULT_PROMPT,
      isVideo: true,
      sourceAspectRatio
    });

    // Prompt for FPS if model has range-based or allowed FPS options
    if ((modelConfig.minFps !== undefined && modelConfig.maxFps !== undefined) || modelConfig.allowedFps) {
      await promptVideoFps(OPTIONS, modelConfig);
    }

    // Video duration - for LTX-2 V2V, auto-set from source video if detected
    if (modelConfig.supportsControlNet && sourceVideoDuration !== null) {
      // Auto-calculate frames from source video duration
      const fps = OPTIONS.fps || modelConfig.defaultFps || 25;
      const maxFrames = modelConfig.maxFrames || 513;
      const minFrames = modelConfig.minFrames || 97;
      const frameStep = modelConfig.frameStep || 8;

      // Calculate frames available in source video (duration * fps, no +1)
      const sourceFrames = Math.round(sourceVideoDuration * fps);

      // For v2v, we can't use more frames than the source video has
      // Model requires 1 + n*8 frames, so find largest valid count <= sourceFrames
      const n = Math.floor((sourceFrames - 1) / frameStep);
      let targetFrames = n * frameStep + 1;

      // Clamp to model max (but NOT min - source video determines lower bound for v2v)
      targetFrames = Math.min(maxFrames, targetFrames);

      if (targetFrames < minFrames) {
        log('⚠️', `Source video (${sourceVideoDuration.toFixed(1)}s, ${sourceFrames} frames) is shorter than model minimum (${minFrames} frames)`);
        log('⚠️', `Using ${targetFrames} frames - output may have artifacts`);
      }

      OPTIONS.frames = targetFrames;
      const actualDuration = (targetFrames - 1) / fps;
      log('🎬', `Using source video length: ${actualDuration.toFixed(1)}s (${targetFrames} frames)`);

      if (sourceVideoDuration > actualDuration + 0.5) {
        log('⚠️', `Note: Source video (${sourceVideoDuration.toFixed(1)}s) exceeds model max, will be trimmed`);
      }
    } else {
      // WAN animate or ffprobe not available - prompt for duration
      await promptVideoDuration(OPTIONS, modelConfig);
    }

    // Animate-replace specific: SAM2 coordinates
    if (modelConfig.supportsSam2Coordinates) {
      await promptAnimateReplaceOptions(OPTIONS);
    }

    // Ask about advanced options
    const advancedChoice = await askQuestion('\nCustomize advanced options? [y/N]: ');
    if (advancedChoice.toLowerCase() === 'y' || advancedChoice.toLowerCase() === 'yes') {
      await promptAdvancedOptions(OPTIONS, modelConfig, { isVideo: true });

      // LTX-2 V2V: Guide strength
      if (modelConfig.supportsControlNet && modelConfig.defaultStrength !== undefined) {
        console.log('\n🎚️  Guide Strength (how closely to follow the reference video)\n');
        const strengthInput = await askQuestion(`  Strength (${modelConfig.minStrength}-${modelConfig.maxStrength}, default: ${modelConfig.defaultStrength}): `);
        if (strengthInput.trim()) {
          const s = parseFloat(strengthInput.trim());
          if (!isNaN(s) && s >= modelConfig.minStrength && s <= modelConfig.maxStrength) {
            OPTIONS.strength = s;
          }
        }
      }

      // Video start position (videoStart)
      console.log('\n⏱️ Video Trimming (optional)\n');
      const videoStartInput = await askQuestion('  Video start position in seconds (default: 0): ');
      if (videoStartInput.trim()) {
        const s = parseFloat(videoStartInput.trim());
        if (!isNaN(s) && s >= 0) {
          OPTIONS.videoStart = s;
        }
      }
    }

    console.log('\n✅ Configuration complete!\n');
  }

  // Apply defaults
  if (!OPTIONS.prompt) OPTIONS.prompt = DEFAULT_PROMPT;
  if (!OPTIONS.fps) OPTIONS.fps = modelConfig.defaultFps || VIDEO_CONSTRAINTS.fps.default;
  if (!OPTIONS.shift) OPTIONS.shift = modelConfig.defaultShift;
  // Video models only support ComfyUI sampler/scheduler
  if (!OPTIONS.sampler) OPTIONS.sampler = modelConfig.defaultComfySampler || 'euler';
  if (!OPTIONS.scheduler) OPTIONS.scheduler = modelConfig.defaultComfyScheduler || 'simple';
  if (OPTIONS.guidance === undefined || OPTIONS.guidance === null) {
    OPTIONS.guidance = modelConfig.defaultGuidance;
  }
  if (!OPTIONS.steps) OPTIONS.steps = modelConfig.defaultSteps;
  // LTX-2 V2V: strength (guide strength)
  if (modelConfig.defaultStrength !== undefined && (OPTIONS.strength === undefined || OPTIONS.strength === null)) {
    OPTIONS.strength = modelConfig.defaultStrength;
  }

  // Use model-specific frame limits
  const maxFrames = modelConfig.maxFrames || VIDEO_CONSTRAINTS.frames.max;
  const minFrames = modelConfig.minFrames || VIDEO_CONSTRAINTS.frames.min;
  const frameStep = modelConfig.frameStep || 1;

  // Parse SAM2 coordinates if provided via CLI
  if (
    OPTIONS.sam2Coordinates &&
    typeof OPTIONS.sam2Coordinates === 'string' &&
    !OPTIONS.sam2Coordinates.startsWith('[')
  ) {
    try {
      OPTIONS.sam2Coordinates = parseSam2Coordinates(OPTIONS.sam2Coordinates);
    } catch (error) {
      console.error(`Error parsing SAM2 coordinates: ${error.message}`);
      process.exit(1);
    }
  }

  // SAM2 coordinates for animate-replace
  // NOTE: Don't set default - let workflow use its pixel-based center coordinates
  // The workflow template has hardcoded pixel coords (e.g., [416, 608] for 832x1216)
  // which correctly target the frame center at the workflow's internal resolution

  // Set dimensions with model-specific constraints
  const dimStep = modelConfig.dimensionStep || 16;
  const minWidth = modelConfig.minWidth || VIDEO_CONSTRAINTS.width.min;
  const minHeight = modelConfig.minHeight || VIDEO_CONSTRAINTS.height.min;
  const maxWidth = modelConfig.maxWidth || VIDEO_CONSTRAINTS.width.max || 3840;
  const maxHeight = modelConfig.maxHeight || VIDEO_CONSTRAINTS.height.max || 3840;

  // For LTX-2 V2V, use recommended dimensions (from source video); otherwise use image dimensions
  const fallbackWidth = modelConfig.supportsControlNet ? recommendedWidth : imageInfo.width;
  const fallbackHeight = modelConfig.supportsControlNet ? recommendedHeight : imageInfo.height;

  // Determine the source aspect ratio for proportional scaling
  const sourceAspectRatio = modelConfig.supportsControlNet && sourceVideoDimensions
    ? sourceVideoDimensions.width / sourceVideoDimensions.height
    : fallbackWidth / fallbackHeight;

  let width, height;

  // If user provided only one dimension, calculate the other proportionally
  if (OPTIONS.width && !OPTIONS.height) {
    width = OPTIONS.width;
    height = Math.round(width / sourceAspectRatio);
  } else if (OPTIONS.height && !OPTIONS.width) {
    height = OPTIONS.height;
    width = Math.round(height * sourceAspectRatio);
  } else {
    // Both provided or neither provided - use values or fallbacks
    width = OPTIONS.width || fallbackWidth;
    height = OPTIONS.height || fallbackHeight;
  }

  ({ width, height } = ensureEvenDimensions(width, height));

  // Align to step size
  width = Math.round(width / dimStep) * dimStep;
  height = Math.round(height / dimStep) * dimStep;

  // Scale proportionally if below minimums (maintain aspect ratio)
  if (width < minWidth || height < minHeight) {
    const scaleForWidth = width < minWidth ? minWidth / width : 1;
    const scaleForHeight = height < minHeight ? minHeight / height : 1;
    const scale = Math.max(scaleForWidth, scaleForHeight);
    width = Math.round(width * scale / dimStep) * dimStep;
    height = Math.round(height * scale / dimStep) * dimStep;
    log('⚠️', `Dimensions scaled up to meet minimums: ${width}x${height}`);
  }

  // Scale proportionally if above maximums (maintain aspect ratio)
  if (width > maxWidth || height > maxHeight) {
    const scaleForWidth = width > maxWidth ? maxWidth / width : 1;
    const scaleForHeight = height > maxHeight ? maxHeight / height : 1;
    const scale = Math.min(scaleForWidth, scaleForHeight);
    width = Math.round(width * scale / dimStep) * dimStep;
    height = Math.round(height * scale / dimStep) * dimStep;
    log('⚠️', `Dimensions scaled down to meet maximums: ${width}x${height}`);
  }

  OPTIONS.width = width;
  OPTIONS.height = height;

  // For LTX-2 V2V, warn if output is larger than source (upscaling will occur)
  if (modelConfig.supportsControlNet && sourceVideoDimensions) {
    if (width > sourceVideoDimensions.width || height > sourceVideoDimensions.height) {
      log('📐', `Output ${width}x${height} > source ${sourceVideoDimensions.width}x${sourceVideoDimensions.height} (will scale to fit)`);
    }
  }

  // Calculate frames from duration if not explicitly set
  if (!OPTIONS.frames) {
    // For LTX-2 V2V non-interactive, try to auto-detect from source video
    let duration = OPTIONS.duration;
    if (!duration && modelConfig.supportsControlNet && sourceVideoDuration !== null) {
      duration = sourceVideoDuration;
    }
    duration = duration || 5;

    let frames = Math.round(duration * OPTIONS.fps) + 1;
    // LTX-2: round to nearest n*frameStep + 1
    if (frameStep > 1) {
      const n = Math.round((frames - 1) / frameStep);
      frames = n * frameStep + 1;
    }
    OPTIONS.frames = Math.max(minFrames, Math.min(maxFrames, frames));
  }

  // Validate FPS - use model-specific range or allowed values
  if (modelConfig.minFps !== undefined && modelConfig.maxFps !== undefined) {
    // Range-based FPS (LTX-2)
    if (OPTIONS.fps < modelConfig.minFps || OPTIONS.fps > modelConfig.maxFps) {
      console.error(`Error: FPS must be between ${modelConfig.minFps} and ${modelConfig.maxFps}`);
      process.exit(1);
    }
  } else if (modelConfig.allowedFps) {
    // Fixed FPS options (WAN)
    if (!modelConfig.allowedFps.includes(OPTIONS.fps)) {
      console.error(`Error: FPS must be one of: ${modelConfig.allowedFps.join(', ')}`);
      process.exit(1);
    }
  }

  // Validate frames
  // For v2v workflows, allow frames below model minimum if source video is shorter
  // (the worker will handle this case and use what's available)
  const effectiveMinFrames = modelConfig.supportsControlNet ? 9 : minFrames; // 9 = 1 + 8*1, smallest valid
  if (OPTIONS.frames < effectiveMinFrames || OPTIONS.frames > maxFrames) {
    console.error(`Error: Frames must be between ${effectiveMinFrames} and ${maxFrames}`);
    process.exit(1);
  }

  // Validate batch count
  if (OPTIONS.batch < 1 || OPTIONS.batch > 512) {
    console.error('Error: Batch count must be between 1 and 512');
    process.exit(1);
  }

  // Create output directory
  if (!fs.existsSync(OPTIONS.output)) {
    fs.mkdirSync(OPTIONS.output, { recursive: true });
  }

  // Initialize client
  const clientConfig = {
    appId: `sogni-workflow-v2v-${Date.now()}`,
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

  let projectEventHandler;
  let jobEventHandler;
  let project;

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
      console.log(
        `💳 Using saved payment preference: ${tokenType.charAt(0).toUpperCase() + tokenType.slice(1)} tokens`
      );
      console.log();
    }

    // Ask for batch count as last question before confirmation
    if (OPTIONS.interactive) {
      await promptBatchCount(OPTIONS, { isVideo: true });
    }

    // Show configuration first
    const videoDuration = (OPTIONS.frames - 1) / OPTIONS.fps;
    const configDisplay = {
      Model: modelConfig.name,
      Prompt: OPTIONS.prompt,
      Workflow: modelConfig.workflowType
    };

    // LTX-2 V2V: show control type
    if (modelConfig.supportsControlNet && OPTIONS.controlNetType) {
      configDisplay['Control Type'] = CONTROL_NET_TYPES[OPTIONS.controlNetType].name;
    }

    // Only show image for models that require it
    if (requiresImage && OPTIONS.image) {
      configDisplay['Image'] = OPTIONS.image;
    }

    configDisplay['Video'] = OPTIONS.video;
    configDisplay['Resolution'] = `${OPTIONS.width}x${OPTIONS.height}`;
    configDisplay['Duration'] = `${videoDuration.toFixed(1)}s`;
    configDisplay['FPS'] = OPTIONS.fps;
    configDisplay['Frames'] = OPTIONS.frames;
    configDisplay['Steps'] = OPTIONS.steps;
    configDisplay['Batch'] = OPTIONS.batch;
    configDisplay['Guidance'] = OPTIONS.guidance;

    // WAN models use shift, LTX-2 V2V uses strength
    if (OPTIONS.shift !== undefined && OPTIONS.shift !== null) {
      configDisplay['Shift'] = OPTIONS.shift;
    }
    if (modelConfig.supportsControlNet && OPTIONS.strength !== undefined) {
      configDisplay['Strength'] = OPTIONS.strength;
    }

    configDisplay['Seed'] = OPTIONS.seed !== null ? OPTIONS.seed : -1;

    // Video models only support ComfyUI sampler/scheduler
    configDisplay['Comfy Sampler'] = OPTIONS.sampler;
    configDisplay['Comfy Scheduler'] = OPTIONS.scheduler;

    if (modelConfig.supportsSam2Coordinates && OPTIONS.sam2Coordinates) {
      const coords = JSON.parse(OPTIONS.sam2Coordinates);
      configDisplay['SAM2 Coords'] = `(${coords[0].x}, ${coords[0].y})`;
    }

    displayConfig('Video Generation Configuration', configDisplay);

    if (OPTIONS.negative) {
      console.log(`   Negative prompt: ${OPTIONS.negative}`);
    }
    if (OPTIONS.style) {
      console.log(`   Style prompt: ${OPTIONS.style}`);
    }

    // Get cost estimate
    log('💵', 'Fetching cost estimate...');
    const estimate = await getVideoJobEstimate(
      tokenType,
      modelConfig.id,
      OPTIONS.width,
      OPTIONS.height,
      OPTIONS.frames,
      OPTIONS.fps,
      OPTIONS.steps
    );

    console.log();
    console.log('📊 Cost Estimate:');

    if (tokenType === 'spark') {
      const costPerVideo = parseFloat(estimate.quote.project.costInSpark || 0);
      const totalCost = costPerVideo * OPTIONS.batch;
      const currentBalance = parseFloat(balance.spark.net || 0);
      if (OPTIONS.batch > 1) {
        console.log(`   Per video: ${costPerVideo.toFixed(2)} Spark`);
        console.log(`   Total (${OPTIONS.batch} videos): ${totalCost.toFixed(2)} Spark`);
      } else {
        console.log(`   Spark: ${totalCost.toFixed(2)}`);
      }
      console.log(
        `   Balance remaining: ${(currentBalance - totalCost).toFixed(2)} Spark`
      );
      console.log(`   USD: $${(totalCost * 0.005).toFixed(4)}`);
    } else {
      const costPerVideo = parseFloat(estimate.quote.project.costInSogni || 0);
      const totalCost = costPerVideo * OPTIONS.batch;
      const currentBalance = parseFloat(balance.sogni.net || 0);
      if (OPTIONS.batch > 1) {
        console.log(`   Per video: ${costPerVideo.toFixed(2)} Sogni`);
        console.log(`   Total (${OPTIONS.batch} videos): ${totalCost.toFixed(2)} Sogni`);
      } else {
        console.log(`   Sogni: ${totalCost.toFixed(2)}`);
      }
      console.log(
        `   Balance remaining: ${(currentBalance - totalCost).toFixed(2)} Sogni`
      );
      console.log(`   USD: $${(totalCost * 0.05).toFixed(4)}`);
    }

    console.log();
    if (OPTIONS.interactive) {
      const proceed = await askQuestion('Proceed with generation? [Y/n]: ');
      if (proceed.toLowerCase() === 'n' || proceed.toLowerCase() === 'no') {
        log('❌', 'Generation cancelled');
        process.exit(0);
      }
    } else {
      console.log('✓ Proceeding with generation (non-interactive mode)');
    }

    // Wait for models
    log('🔄', 'Loading available models...');
    const models = await sogni.projects.waitForModels();
    const videoModel = models.find((m) => m.id === modelConfig.id);

    if (!videoModel) {
      throw new Error(`Model ${modelConfig.id} not available`);
    }

    log('✓', `Model ready: ${videoModel.name}`);
    console.log();

    // Generate seed client-side if not specified (for reliable filename generation)
    if (OPTIONS.seed === null || OPTIONS.seed === -1) {
      OPTIONS.seed = generateRandomSeed();
      log('🎲', `Generated seed: ${OPTIONS.seed}`);
    }

    // Create project
    log('📤', 'Submitting video-to-video job...');
    if (modelConfig.supportsControlNet) {
      log('🎬', `Generating ${OPTIONS.controlNetType}-controlled video...`);
    } else {
      log('🎬', 'Generating animated video...');
    }
    console.log();

    // CRITICAL: SDK requires Buffer/File/Blob objects for media uploads, NOT string paths.
    // Passing string paths will silently fail (the string text gets uploaded instead of file contents).
    // Note: If target FPS > source FPS, the worker will interpolate the video server-side
    const referenceVideoBuffer = readFileAsBuffer(OPTIONS.video);

    const projectParams = {
      type: 'video',
      modelId: modelConfig.id,
      positivePrompt: OPTIONS.prompt,
      numberOfMedia: OPTIONS.batch,
      width: OPTIONS.width,
      height: OPTIONS.height,
      frames: OPTIONS.frames,
      fps: OPTIONS.fps,
      steps: OPTIONS.steps,
      seed: OPTIONS.seed,
      referenceVideo: referenceVideoBuffer,
      tokenType: tokenType
    };

    // Add reference image if provided (handles both required and optional cases like pose control)
    if (OPTIONS.image) {
      const referenceImageBuffer = readFileAsBuffer(OPTIONS.image);
      projectParams.referenceImage = referenceImageBuffer;
    }

    // WAN models use shift
    if (OPTIONS.shift !== undefined && OPTIONS.shift !== null) {
      projectParams.shift = OPTIONS.shift;
    }

    // Video models only support ComfyUI sampler/scheduler
    if (OPTIONS.sampler) projectParams.sampler = OPTIONS.sampler;
    if (OPTIONS.scheduler) projectParams.scheduler = OPTIONS.scheduler;

    // LTX-2 V2V: add controlNet params
    if (modelConfig.supportsControlNet && OPTIONS.controlNetType) {
      projectParams.controlNet = {
        name: OPTIONS.controlNetType,
        ...(OPTIONS.strength !== undefined && OPTIONS.strength !== null && { strength: OPTIONS.strength })
      };
    }

    // Add SAM2 coordinates for animate-replace
    if (modelConfig.supportsSam2Coordinates && OPTIONS.sam2Coordinates) {
      projectParams.sam2Coordinates = OPTIONS.sam2Coordinates;
    }

    // Add guidance
    if (OPTIONS.guidance !== undefined && OPTIONS.guidance !== null) {
      projectParams.guidance = OPTIONS.guidance;
    }

    // Add optional prompts
    if (OPTIONS.negative) {
      projectParams.negativePrompt = OPTIONS.negative;
    }
    if (OPTIONS.style) {
      projectParams.stylePrompt = OPTIONS.style;
    }

    // Add video start offset for trimming
    if (OPTIONS.videoStart !== undefined && OPTIONS.videoStart !== null && OPTIONS.videoStart > 0) {
      projectParams.videoStart = OPTIONS.videoStart;
    }

    project = await sogni.projects.create(projectParams);

    // Set up event handlers
    let completedVideos = 0;
    let failedVideos = 0;
    const totalVideos = OPTIONS.batch;
    let projectFailed = false;

    // Track per-job state for progress display
    const jobStates = new Map(); // jobId -> { startTime, lastStep, lastStepCount, lastETA, lastETAUpdate, interval, jobIndex }
    let activeJobId = null; // Track which job is currently showing progress

    // Helper to get job label (e.g., "Job 1/2")
    function getJobLabel(event, jobId = null) {
      if (totalVideos === 1) return '';
      // First try to get jobIndex from event, then from stored state
      let jobNum = event.jobIndex;
      if (jobNum === undefined && jobId) {
        const state = jobStates.get(jobId);
        if (state?.jobIndex !== undefined) {
          jobNum = state.jobIndex;
        }
      }
      jobNum = jobNum !== undefined ? jobNum + 1 : '?';
      return `[${jobNum}/${totalVideos}] `;
    }

    // Helper to clear progress line
    function clearProgressLine() {
      process.stdout.write('\r' + ' '.repeat(80) + '\r');
    }

    // Helper to stop progress display for a job
    function stopJobProgress(jobId) {
      const state = jobStates.get(jobId);
      if (state?.interval) {
        clearInterval(state.interval);
        state.interval = null;
        clearProgressLine();
      }
      if (activeJobId === jobId) {
        activeJobId = null;
      }
    }

    projectEventHandler = (event) => {
      if (event.projectId !== project.id) return;
      switch (event.type) {
        case 'queued':
          log('📋', `Project queued at position: ${event.queuePosition}`);
          break;
        case 'completed':
          log('✅', 'Project completed!');
          break;
        case 'error':
          projectFailed = true;
          log('❌', `Project failed: ${event.error?.message || event.error || 'Unknown error'}`);
          if (event.error?.code) {
            console.log(`   Error code: ${event.error.code}`);
          }
          checkWorkflowCompletion();
          break;
      }
    };

    jobEventHandler = (event) => {
      if (event.projectId !== project.id) return;
      const jobId = event.jobId;

      switch (event.type) {
        case 'queued': {
                    const queuedLabel = getJobLabel(event, jobId);
          log('📋', `${queuedLabel}Job queued at position: ${event.queuePosition}`);
          break;
        }

        case 'initiating': {
                    // Pre-create job state with jobIndex if provided
          if (!jobStates.has(jobId) && event.jobIndex !== undefined) {
            jobStates.set(jobId, {
              startTime: null,
              lastStep: undefined,
              lastStepCount: undefined,
              lastETA: undefined,
              lastETAUpdate: null,
              interval: null,
              jobIndex: event.jobIndex
            });
          } else if (jobStates.has(jobId) && event.jobIndex !== undefined) {
            jobStates.get(jobId).jobIndex = event.jobIndex;
          }
          const initLabel = getJobLabel(event, jobId);
          log('⚙️', `${initLabel}Model initiating on worker: ${event.workerName || 'Unknown'}`);
          break;
        }

        case 'started': {
                    // Initialize or update state for this job
          let jobState = jobStates.get(jobId);
          if (!jobState) {
            jobState = {
              startTime: Date.now(),
              lastStep: undefined,
              lastStepCount: undefined,
              lastETA: undefined,
              lastETAUpdate: Date.now(),
              interval: null,
              jobIndex: event.jobIndex
            };
            jobStates.set(jobId, jobState);
          } else {
            // Update existing state from initiating
            jobState.startTime = Date.now();
            jobState.lastETAUpdate = Date.now();
            if (event.jobIndex !== undefined) {
              jobState.jobIndex = event.jobIndex;
            }
          }

          // Get job label using stored jobIndex
          const startedLabel = getJobLabel(event, jobId);

          // Start progress display for this job
          activeJobId = jobId;
          jobState.interval = setInterval(() => {
            const state = jobStates.get(jobId);
            if (!state) return;

            const elapsed = (Date.now() - state.startTime) / 1000;
            const progressLabel = getJobLabel({}, jobId);
            let progressStr = `\r  ${progressLabel}Generating...`;
            if (state.lastStep !== undefined && state.lastStepCount !== undefined) {
              const stepPercent = Math.round((state.lastStep / state.lastStepCount) * 100);
              progressStr += ` Step ${state.lastStep}/${state.lastStepCount} (${stepPercent}%)`;
            }
            if (state.lastETA !== undefined) {
              const elapsedSinceUpdate = (Date.now() - state.lastETAUpdate) / 1000;
              const adjustedETA = Math.max(1, state.lastETA - elapsedSinceUpdate);
              progressStr += ` ETA: ${formatDuration(adjustedETA)}`;
            }
            progressStr += ` (${formatDuration(elapsed)} elapsed)   `;
            process.stdout.write(progressStr);
          }, 1000);

          log('🚀', `${startedLabel}Job started on worker: ${event.workerName || 'Unknown'}`);
          break;
        }

        case 'jobETA': {
                    const state = jobStates.get(jobId);
          if (state) {
            state.lastETA = event.etaSeconds;
            state.lastETAUpdate = Date.now();
          }
          break;
        }

        case 'progress': {
                    const state = jobStates.get(jobId);
          if (state && event.step !== undefined && event.stepCount !== undefined) {
            state.lastStep = event.step;
            state.lastStepCount = event.stepCount;
          }
          break;
        }

        case 'completed': {
                    const state = jobStates.get(jobId);
          const completedLabel = getJobLabel(event, jobId);

          // Show final progress before clearing (fixes "Step 6/8" never reaching 8/8)
          if (state && state.lastStepCount !== undefined) {
            clearProgressLine();
            const finalSteps = event.performedStepCount || state.lastStepCount;
            process.stdout.write(`\r  ${completedLabel}Step ${finalSteps}/${finalSteps} (100%)   \n`);
          }

          stopJobProgress(jobId);

          if (!event.resultUrl || event.error) {
            failedVideos++;
            log('❌', `${completedLabel}Job completed with error: ${event.error || 'No result URL'}`);
            jobStates.delete(jobId);
            checkWorkflowCompletion();
          } else {
            if (projectFailed) {
              log('⚠️', `${completedLabel}Ignoring completion event for already failed project`);
              return;
            }
            log('✅', `${completedLabel}Job completed!`);

            // Calculate elapsed time for THIS job
            const jobElapsedSeconds = state ? (Date.now() - state.startTime) / 1000 : null;
            const jobElapsed = jobElapsedSeconds ? jobElapsedSeconds.toFixed(2) : '?';

            // Use seed + jobIndex for batch jobs (server increments seed per job)
            const jobSeed = OPTIONS.seed + (state?.jobIndex || 0);

            // Include control type in filename for LTX-2 v2v
            const modelIdForFilename = modelConfig.supportsControlNet && OPTIONS.controlNetType
              ? `${modelConfig.id}-${OPTIONS.controlNetType}`
              : modelConfig.id;

            const desiredPath = generateVideoFilename({
              modelId: modelIdForFilename,
              frames: OPTIONS.frames,
              fps: OPTIONS.fps,
              width: OPTIONS.width,
              height: OPTIONS.height,
              seed: jobSeed,
              prompt: OPTIONS.prompt,
              generationTime: jobElapsedSeconds,
              outputDir: OPTIONS.output
            });
            const outputPath = getUniqueFilename(desiredPath);

            downloadVideo(event.resultUrl, outputPath)
              .then(() => {
                completedVideos++;
                log('✓', `${completedLabel}Video completed (${jobElapsed}s)`);
                log('💾', `Saved: ${outputPath}`);
                openVideo(outputPath);
                jobStates.delete(jobId);
                checkWorkflowCompletion();
              })
              .catch((error) => {
                failedVideos++;
                log('❌', `${completedLabel}Download failed: ${error.message}`);
                jobStates.delete(jobId);
                checkWorkflowCompletion();
              });
          }
          break;
        }

        case 'error':
        case 'failed': {
                    const errorLabel = getJobLabel(event, jobId);
          stopJobProgress(jobId);
          projectFailed = true;
          failedVideos++;
          const errorMsg = event.error?.message || event.error || 'Unknown error';
          const errorCode = event.error?.code;
          if (errorCode !== undefined && errorCode !== null) {
            log('❌', `${errorLabel}Job failed: ${errorMsg} (Error code: ${errorCode})`);
          } else {
            log('❌', `${errorLabel}Job failed: ${errorMsg}`);
          }
          jobStates.delete(jobId);
          checkWorkflowCompletion();
          break;
        }
      }
    };

    sogni.projects.on('project', projectEventHandler);
    sogni.projects.on('job', jobEventHandler);

    function checkWorkflowCompletion() {
      if (completedVideos + failedVideos === totalVideos) {
        if (failedVideos === 0) {
          if (totalVideos === 1) {
            log('🎉', 'Video generated successfully!');
          } else {
            log('🎉', `All ${totalVideos} videos generated successfully!`);
          }
          console.log();
          // Give a small delay for all video players to open
          process.exit(0);
        } else {
          log(
            '❌',
            `${failedVideos} out of ${totalVideos} video${totalVideos > 1 ? 's' : ''} failed to generate`
          );
          console.log();
          process.exit(1);
        }
      }
    }

    // Wait for all jobs to complete - SDK and server handle their own timeouts
    await new Promise((resolve) => {
      const checkCompletion = () => {
        if (projectFailed || completedVideos + failedVideos >= totalVideos) {
          resolve();
        } else {
          setTimeout(checkCompletion, 1000);
        }
      };
      checkCompletion();
    });

    if (projectFailed || failedVideos > 0) {
      const failureCount = projectFailed ? totalVideos : failedVideos;
      log('❌', `Workflow failed with ${failureCount} failed video${failureCount > 1 ? 's' : ''}`);
      process.exit(1);
    } else {
      log('✅', 'Workflow completed successfully!');
    }
  } catch (error) {
    log('❌', `Error: ${error.message}`);
    process.exit(1);
  } finally {
    if (projectEventHandler) {
      sogni.projects.off('project', projectEventHandler);
    }
    if (jobEventHandler) {
      sogni.projects.off('job', jobEventHandler);
    }
    // Clean up all per-job progress intervals
    for (const [jobId, state] of jobStates) {
      if (state?.interval) {
        clearInterval(state.interval);
      }
    }
    jobStates.clear();
    try {
      await sogni.account.logout();
    } catch {
      // Ignore logout errors
    }
  }
}

async function getVideoJobEstimate(tokenType, modelId, width, height, frames, fps, steps) {
  let baseUrl = process.env.SOGNI_SOCKET_ENDPOINT || 'https://socket.sogni.ai';
  if (baseUrl.startsWith('wss://')) {
    baseUrl = baseUrl.replace('wss://', 'https://');
  } else if (baseUrl.startsWith('ws://')) {
    baseUrl = baseUrl.replace('ws://', 'https://');
  }
  const url = `${baseUrl}/api/v1/job-video/estimate/${tokenType}/${encodeURIComponent(modelId)}/${width}/${height}/${frames}/${fps}/${steps}`;
  console.log(`🔗 Video cost estimate URL: ${url}`);
  const response = await fetch(url);

  // Read body as text first, then try to parse as JSON
  const text = await response.text();

  if (!response.ok) {
    if (text.includes('Model not found') || text.includes('not found')) {
      throw new Error(`Model '${modelId}' is not available on this server. The model may not be deployed yet.`);
    }
    throw new Error(`Failed to get cost estimate: ${response.statusText} - ${text}`);
  }

  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`Invalid response from server: ${text.substring(0, 100)}`);
  }
}

async function downloadVideo(url, outputPath) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download video: ${response.statusText}`);
  }

  const fileStream = fs.createWriteStream(outputPath);
  await streamPipeline(response.body, fileStream);
}

function openVideo(videoPath) {
  const { platform } = process;
  let command;

  if (platform === 'darwin') {
    command = `open "${videoPath}"`;
  } else if (platform === 'win32') {
    command = `start "" "${videoPath}"`;
  } else {
    command = `xdg-open "${videoPath}"`;
  }

  exec(command, (error) => {
    if (error) {
      log('⚠️', `Could not auto-open video: ${error.message}`);
    } else {
      log('🎬', `Opened video in player: ${videoPath}`);
    }
  });
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
