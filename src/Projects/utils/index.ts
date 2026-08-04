import {
  AssetRequirement,
  EnhancementStrength,
  VideoAssetKey,
  VideoProjectParams,
  VideoWorkflowType
} from '../types/index.js';

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
  return (
    modelId.startsWith('wan_') ||
    modelId.startsWith('ltx2-') ||
    modelId.startsWith('ltx23-') ||
    modelId.startsWith('seedance-2-0') ||
    modelId.startsWith('happyhorse-1.1') ||
    modelId.startsWith('minimax-h3')
  );
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
 * Check if a model ID is a WAN animate model (animate-move or animate-replace).
 * These models support up to 321 frames (20s at 16fps).
 */
export function isWanAnimateModel(modelId: string): boolean {
  return modelId.includes('_animate-move') || modelId.includes('_animate-replace');
}

/**
 * Check if a model ID is an LTX-2/LTX-2.3 video model.
 *
 * LTX-2.3 models generate video at the actual specified FPS (1-60 fps range).
 * There is no post-render interpolation - fps directly affects generation.
 *
 * Frame count should be calculated as: duration * fps + 1
 * Additionally, LTX-2.3 has a frame step constraint where frames must follow
 * the pattern: 1 + n*8 (i.e., 1, 9, 17, 25, 33, 41, ...)
 *
 * Note: `ltx2-` prefix is kept for backwards compatibility (server translates
 * ltx2- model IDs to ltx23- equivalents).
 */
export function isLtx2Model(modelId: string): boolean {
  return modelId.startsWith('ltx2-') || modelId.startsWith('ltx23-');
}

/**
 * Check if a model ID is a Seedance 2.0 video model.
 *
 * Seedance models are external API-backed video models. They generate at
 * 24fps and support 4-15 second direct SDK project durations.
 */
export function isSeedanceModel(modelId: string): boolean {
  return modelId.startsWith('seedance-2-0');
}

/**
 * Check if a model ID is an Alibaba HappyHorse 1.1 video model.
 *
 * HappyHorse models are external API-backed video models. They generate at
 * 24fps with native audio and support 3-15 second direct SDK project
 * durations. They accept image-only reference context: the i2v variant takes
 * a single first-frame image and the r2v variant takes 1-9 reference images.
 * Unlike Seedance, HappyHorse does not accept reference video or reference
 * audio assets.
 */
export function isHappyhorseModel(modelId: string): boolean {
  return modelId.startsWith('happyhorse-1.1');
}

/**
 * Check if a model ID is a MiniMax H3 video model.
 *
 * Workflow IDs are `minimax-h3-fl2va-fp8_t2v`, `..._i2v`, and `..._flf2v`.
 */
export function isMinimaxH3Model(modelId: string): boolean {
  return modelId.startsWith('minimax-h3');
}

/**
 * Check if a model ID is an external API-backed video model (Seedance 2.0 or
 * HappyHorse 1.1).
 *
 * These vendor families share the external API routing path: fixed 24fps
 * generation, Spark-only billing, no negative prompt, and HTTPS/local
 * reference context handling. Use this where the same gate applies to both
 * families; use the model-specific checks (`isSeedanceModel` /
 * `isHappyhorseModel`) for behavior that differs, such as reference asset
 * validation and minimum duration.
 */
export function isExternalApiVideoModel(modelId: string): boolean {
  return isSeedanceModel(modelId) || isHappyhorseModel(modelId);
}

/**
 * LTX-2.3 frame step constraint.
 * Valid frame counts follow the pattern: 1 + n*8 (i.e., 1, 9, 17, 25, 33, ...)
 */
export const LTX2_FRAME_STEP = 8;

/**
 * MiniMax H3 sampling grid. Frame counts are `MINIMAX_H3_BASE_FRAMES + n*17`,
 * generated at a fixed 24fps. Values off this grid are invalid.
 */
export const MINIMAX_H3_FPS = 24;
export const MINIMAX_H3_FRAME_STEP = 17;
export const MINIMAX_H3_BASE_FRAMES = 124;
export const MINIMAX_H3_MIN_FRAMES = 124;
export const MINIMAX_H3_MAX_FRAMES = 362;
export const MINIMAX_H3_DIMENSION_STEP = 32;
export const MINIMAX_H3_MAX_DIMENSION = 1344;
export const MINIMAX_H3_MAX_PIXELS = 1_032_192;

/**
 * Shortest MiniMax H3 duration, in seconds (124 frames at 24fps).
 */
export const MINIMAX_H3_MIN_DURATION = MINIMAX_H3_MIN_FRAMES / MINIMAX_H3_FPS;

/**
 * Longest MiniMax H3 duration, in seconds (362 frames at 24fps).
 */
export const MINIMAX_H3_MAX_DURATION = MINIMAX_H3_MAX_FRAMES / MINIMAX_H3_FPS;

/**
 * Calculate the frame count for a given duration and fps based on the video model.
 *
 * ## Standard Behavior (LTX-2.3, Seedance, and future models)
 * - Generate at the actual specified FPS (no interpolation)
 * - Formula: duration * fps + 1
 * - LTX-2.3 specific: Frame count must follow the pattern: 1 + n*8
 *
 * ## MiniMax H3
 * - Fixed 24fps generation; the fps argument is ignored
 * - Frame count must follow the pattern: 124 + n*17, clamped to 124-362
 * - Note there is no `+1` here: 124 frames is exactly 5.167s, not 5.125s
 *
 * ## Legacy Behavior (WAN 2.2 only)
 * - Always generate at 16fps internally, regardless of the fps parameter
 * - fps=32 is post-render interpolation that doubles frames
 * - Formula: duration * 16 + 1
 *
 * @param modelId - The video model ID
 * @param duration - Duration in seconds
 * @param fps - Frames per second (ignored for WAN models which always use 16fps
 *   and for MiniMax H3 which always uses 24fps)
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
  } else if (isMinimaxH3Model(modelId)) {
    // MiniMax H3: fixed 24fps, frame count snapped to the 124 + n*17 grid.
    // The generic `duration * fps + 1` formula yields 121 for a 5s request,
    // which is off-grid and below the minimum, so the server rejects it.
    const requestedFrames = Math.round(duration * MINIMAX_H3_FPS);
    const minimum = Math.max(MINIMAX_H3_MIN_FRAMES, minFrames ?? MINIMAX_H3_MIN_FRAMES);
    const maximum = Math.min(MINIMAX_H3_MAX_FRAMES, maxFrames ?? MINIMAX_H3_MAX_FRAMES);
    const minimumStep = Math.ceil((minimum - MINIMAX_H3_BASE_FRAMES) / MINIMAX_H3_FRAME_STEP);
    const maximumStep = Math.floor((maximum - MINIMAX_H3_BASE_FRAMES) / MINIMAX_H3_FRAME_STEP);
    if (minimumStep > maximumStep) {
      throw new RangeError(
        `No valid MiniMax H3 frame count exists between ${minimum} and ${maximum}`
      );
    }
    const requestedStep = Math.round(
      (requestedFrames - MINIMAX_H3_BASE_FRAMES) / MINIMAX_H3_FRAME_STEP
    );
    const steps = Math.min(maximumStep, Math.max(minimumStep, requestedStep));
    frames = MINIMAX_H3_BASE_FRAMES + steps * MINIMAX_H3_FRAME_STEP;
    return frames;
  } else {
    // LTX-2.3 and future models: Generate at actual fps
    // This is the standard behavior going forward
    frames = Math.round(duration * fps) + 1;

    // LTX-2.3 specific: snap to frame step constraint (1 + n*8)
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
  const isLtx2 = modelId.startsWith('ltx2-') || modelId.startsWith('ltx23-');
  const isSeedance = modelId.startsWith('seedance-2-0');
  const isHappyhorse = modelId.startsWith('happyhorse-1.1');
  const isMinimaxH3 = modelId.startsWith('minimax-h3');

  if (!isWan && !isLtx2 && !isSeedance && !isHappyhorse && !isMinimaxH3) return null;

  // HappyHorse encodes the workflow directly in the model id using hyphenated
  // suffixes: happyhorse-1.1-t2v, happyhorse-1.1-i2v, happyhorse-1.1-r2v.
  if (isHappyhorse) {
    if (modelId.includes('-r2v')) return 'r2v';
    if (modelId.includes('-i2v')) return 'i2v';
    if (modelId.includes('-t2v')) return 't2v';
    return null;
  }

  // MiniMax H3 model ids carry the workflow as an underscore suffix on a
  // shared checkpoint name: minimax-h3-fl2va-fp8_t2v / _i2v / _flf2v.
  // Check _flf2v explicitly - the shared 'fl2va' checkpoint segment must not be
  // mistaken for a workflow suffix.
  if (isMinimaxH3) {
    if (modelId.includes('_flf2v')) return 'flf2v';
    if (modelId.includes('_i2v')) return 'i2v';
    if (modelId.includes('_t2v')) return 't2v';
    return null;
  }

  // WAN, LTX-2.3, and Seedance models share similar workflow type suffixes
  if (modelId.includes('_i2v')) return 'i2v';
  if (modelId.includes('_t2v')) return 't2v';

  // LTX-2.3 v2v ControlNet and Seedance v2v workflows
  if ((isLtx2 || isSeedance) && modelId.includes('_v2v')) return 'v2v';

  // LTX-2.3 and Seedance image+audio workflows
  // ia2v = image+audio to video (requires referenceImage + referenceAudio)
  // a2v = audio to video (requires referenceAudio only)
  // Note: Check _ia2v before _a2v since _ia2v contains _a2v as a substring
  if ((isLtx2 || isSeedance) && modelId.includes('_ia2v')) return 'ia2v';
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
    referenceAudioIdentity: 'optional',
    referenceVideo: 'forbidden',
    referenceMask: 'forbidden'
  },
  i2v: {
    referenceImage: 'optional',
    referenceImageEnd: 'optional',
    referenceAudio: 'forbidden',
    referenceAudioIdentity: 'optional',
    referenceVideo: 'forbidden',
    referenceMask: 'forbidden'
  },
  flf2v: {
    // MiniMax H3 first-and-last-frame video. Unlike the i2v workflow, which
    // accepts either endpoint, flf2v interpolates a path between two anchors
    // and needs both of them.
    referenceImage: 'required',
    referenceImageEnd: 'required',
    referenceAudio: 'forbidden',
    referenceAudioIdentity: 'forbidden',
    referenceVideo: 'forbidden',
    referenceMask: 'forbidden'
  },
  s2v: {
    referenceImage: 'required',
    referenceImageEnd: 'forbidden',
    referenceAudio: 'required',
    referenceAudioIdentity: 'forbidden',
    referenceVideo: 'forbidden',
    referenceMask: 'forbidden'
  },
  ia2v: {
    referenceImage: 'required',
    referenceImageEnd: 'forbidden',
    referenceAudio: 'required',
    referenceAudioIdentity: 'forbidden',
    referenceVideo: 'forbidden',
    referenceMask: 'forbidden'
  },
  a2v: {
    referenceImage: 'forbidden',
    referenceImageEnd: 'forbidden',
    referenceAudio: 'required',
    referenceAudioIdentity: 'forbidden',
    referenceVideo: 'forbidden',
    referenceMask: 'forbidden'
  },
  'animate-move': {
    referenceImage: 'required',
    referenceImageEnd: 'forbidden',
    referenceAudio: 'forbidden',
    referenceAudioIdentity: 'forbidden',
    referenceVideo: 'required',
    referenceMask: 'forbidden'
  },
  'animate-replace': {
    referenceImage: 'required',
    referenceImageEnd: 'forbidden',
    referenceAudio: 'forbidden',
    referenceAudioIdentity: 'forbidden',
    referenceVideo: 'required',
    referenceMask: 'forbidden'
  },
  v2v: {
    referenceImage: 'optional', // Required for pose control, optional for other control types
    referenceImageEnd: 'forbidden',
    referenceAudio: 'forbidden',
    referenceAudioIdentity: 'optional',
    referenceVideo: 'required',
    referenceMask: 'optional' // Used only by the inpaint control type; outpaint is positional
  },
  r2v: {
    // HappyHorse reference-to-video: 1-9 image references (via referenceImage
    // and/or referenceImageUrls), no video/audio context. Detailed count
    // limits are enforced by validateHappyhorseReferenceAssets.
    referenceImage: 'optional',
    referenceImageEnd: 'forbidden',
    referenceAudio: 'forbidden',
    referenceAudioIdentity: 'forbidden',
    referenceVideo: 'forbidden',
    referenceMask: 'forbidden'
  }
};

/**
 * Whether a `referenceMask` should be honored for the given video params.
 * Only the LTX-2.3 v2v 'inpaint' control type consumes a mask.
 */
export function usesReferenceMask(params: VideoProjectParams): boolean {
  return params.controlNet?.name === 'inpaint';
}
