import { AssetRequirement, EnhancementStrength, VideoAssetKey, VideoWorkflowType } from '../types';

export function getEnhacementStrength(strength: EnhancementStrength): number {
  switch (strength) {
    case 'light':
      return 0.15;
    case 'heavy':
      return 0.49;
    default:
      return 0.35;
  }
}

/**
 * Check if a model ID is for a video workflow.
 * This is consistent with the `media` property returned by the models list API.
 * Video models produce MP4 output; image models produce PNG/JPG output.
 */
export function isVideoModel(modelId: string): boolean {
  return modelId.startsWith('wan_') || modelId.startsWith('ltx2-');
}

/**
 * Check if a model ID is for an audio workflow (e.g., ACE-Step).
 * Audio models produce MP3 output by default.
 */
export function isAudioModel(modelId: string): boolean {
  return modelId.startsWith('ace_step');
}

/**
 * Check if a model ID is a WAN 2.2 video model.
 *
 * WAN 2.2 models always generate video at 16fps internally.
 * The fps parameter (16 or 32) only controls post-render frame interpolation:
 * - fps=16: No interpolation, output matches generation
 * - fps=32: Frames are doubled via interpolation after generation
 *
 * Therefore, frame count should always be calculated as: duration * 16 + 1
 */
export function isWanModel(modelId: string): boolean {
  return modelId.startsWith('wan_');
}

/**
 * Check if a model ID is an LTX-2 video model.
 *
 * LTX-2 models generate video at the actual specified FPS (1-60 fps range).
 * There is no post-render interpolation - fps directly affects generation.
 *
 * Frame count should be calculated as: duration * fps + 1
 * Additionally, LTX-2 has a frame step constraint where frames must follow
 * the pattern: 1 + n*8 (i.e., 1, 9, 17, 25, 33, 41, ...)
 */
export function isLtx2Model(modelId: string): boolean {
  return modelId.startsWith('ltx2-');
}

/**
 * LTX-2 frame step constraint.
 * Valid frame counts follow the pattern: 1 + n*8 (i.e., 1, 9, 17, 25, 33, ...)
 */
export const LTX2_FRAME_STEP = 8;

/**
 * Calculate the frame count for a given duration and fps based on the video model.
 *
 * ## Standard Behavior (LTX-2 and future models)
 * - Generate at the actual specified FPS (no interpolation)
 * - Formula: duration * fps + 1
 * - LTX-2 specific: Frame count must follow the pattern: 1 + n*8
 *
 * ## Legacy Behavior (WAN 2.2 only)
 * - Always generate at 16fps internally, regardless of the fps parameter
 * - fps=32 is post-render interpolation that doubles frames
 * - Formula: duration * 16 + 1
 *
 * @param modelId - The video model ID
 * @param duration - Duration in seconds
 * @param fps - Frames per second (ignored for WAN models which always use 16fps)
 * @param minFrames - Minimum frame count (optional, defaults to 17)
 * @param maxFrames - Maximum frame count (optional, defaults to model-specific limits)
 * @returns The calculated frame count
 */
export function calculateVideoFrames(
  modelId: string,
  duration: number,
  fps: number,
  minFrames?: number,
  maxFrames?: number
): number {
  let frames: number;

  if (isWanModel(modelId)) {
    // WAN 2.2: Always generates at 16fps, fps param is for post-render interpolation only
    // This is legacy behavior specific to WAN models
    frames = Math.round(duration * 16) + 1;
  } else {
    // LTX-2 and future models: Generate at actual fps
    // This is the standard behavior going forward
    frames = Math.round(duration * fps) + 1;

    // LTX-2 specific: snap to frame step constraint (1 + n*8)
    if (isLtx2Model(modelId)) {
      const n = Math.round((frames - 1) / LTX2_FRAME_STEP);
      frames = n * LTX2_FRAME_STEP + 1;
    }
  }

  // Apply min/max constraints if provided
  if (minFrames !== undefined) {
    frames = Math.max(minFrames, frames);
  }
  if (maxFrames !== undefined) {
    frames = Math.min(maxFrames, frames);
  }

  return frames;
}

/**
 * Get the video workflow type from a model ID.
 * Returns null for non-video models.
 */
export function getVideoWorkflowType(modelId: string): VideoWorkflowType {
  if (!modelId) return null;

  // Check for supported video model prefixes
  const isWan = modelId.startsWith('wan_');
  const isLtx2 = modelId.startsWith('ltx2-');

  if (!isWan && !isLtx2) return null;

  // WAN and LTX-2 models share similar workflow type suffixes
  if (modelId.includes('_i2v')) return 'i2v';
  if (modelId.includes('_t2v')) return 't2v';

  // LTX-2 v2v ControlNet workflows (model IDs use underscore: ltx2-19b-fp8_v2v_distilled)
  if (isLtx2 && modelId.includes('_v2v')) return 'v2v';

  // LTX-2 audio-to-video workflows
  // ia2v = image+audio to video (requires referenceImage + referenceAudio)
  // a2v = audio to video (requires referenceAudio only)
  // Note: Check _ia2v before _a2v since _ia2v contains _a2v as a substring
  if (isLtx2 && modelId.includes('_ia2v')) return 'ia2v';
  if (isLtx2 && modelId.includes('_a2v')) return 'a2v';

  // WAN-specific workflow types
  if (isWan) {
    if (modelId.includes('_s2v')) return 's2v';
    if (modelId.includes('_animate-move')) return 'animate-move';
    if (modelId.includes('_animate-replace')) return 'animate-replace';
  }

  return null;
}

/**
 * Asset requirements for each video workflow type.
 * - required: Must be provided
 * - optional: Can be provided
 * - forbidden: Must NOT be provided
 */
export const VIDEO_WORKFLOW_ASSETS: Record<
  NonNullable<VideoWorkflowType>,
  Record<VideoAssetKey, AssetRequirement>
> = {
  t2v: {
    referenceImage: 'forbidden',
    referenceImageEnd: 'forbidden',
    referenceAudio: 'forbidden',
    referenceVideo: 'forbidden'
  },
  i2v: {
    referenceImage: 'optional',
    referenceImageEnd: 'optional',
    referenceAudio: 'forbidden',
    referenceVideo: 'forbidden'
  },
  s2v: {
    referenceImage: 'required',
    referenceAudio: 'required',
    referenceImageEnd: 'forbidden',
    referenceVideo: 'forbidden'
  },
  ia2v: {
    referenceImage: 'required',
    referenceAudio: 'required',
    referenceImageEnd: 'forbidden',
    referenceVideo: 'forbidden'
  },
  a2v: {
    referenceImage: 'forbidden',
    referenceAudio: 'required',
    referenceImageEnd: 'forbidden',
    referenceVideo: 'forbidden'
  },
  'animate-move': {
    referenceImage: 'required',
    referenceVideo: 'required',
    referenceImageEnd: 'forbidden',
    referenceAudio: 'forbidden'
  },
  'animate-replace': {
    referenceImage: 'required',
    referenceVideo: 'required',
    referenceImageEnd: 'forbidden',
    referenceAudio: 'forbidden'
  },
  v2v: {
    referenceImage: 'optional', // Required for pose control, optional for other control types
    referenceImageEnd: 'forbidden',
    referenceAudio: 'forbidden',
    referenceVideo: 'required'
  }
};
