import {
  AssetRequirement,
  EnhancementStrength,
  InputMedia,
  VideoAssetKey,
  VideoProjectParams,
  VideoWorkflowType
} from '../types/index.js';

const LTX_WORKFLOWS = ['t2v', 'i2v', 'a2v', 'ia2v', 'v2v'] as const;
const LTX_VIDEO_MODEL_IDS = new Set([
  ...LTX_WORKFLOWS.flatMap((workflow) => [
    `ltx2-19b-fp8_${workflow}`,
    `ltx2-19b-fp8_${workflow}_distilled`,
    `ltx23-22b-fp8_${workflow}_distilled`,
    `ltx23-22b-fp8_${workflow}_dev`,
    `ltx25-22b-int8_${workflow}_distilled`,
    `ltx25-22b-int8_${workflow}_dev`
  ]),
  'ltx23-22b-10eros-v1.4-fp8mixed_i2v'
]);
const WAN_VIDEO_MODEL_IDS = new Set([
  'wan_v2.2-14b-fp8_t2v',
  'wan_v2.2-14b-fp8_i2v',
  'wan_v2.2-14b-fp8_t2v_lightx2v',
  'wan_v2.2-14b-fp8_i2v_lightx2v',
  'wan_v2.2-14b-fp8_s2v_lightx2v',
  'wan_v2.2-14b-fp8_animate-move_lightx2v',
  'wan_v2.2-14b-fp8_animate-replace_lightx2v'
]);
const SEEDANCE_VIDEO_MODEL_IDS = new Set([
  'seedance-2-0',
  'seedance-2-0-mini',
  'seedance-2-0-fast',
  'seedance-2-5'
]);
const HAPPYHORSE_VIDEO_MODEL_IDS = new Set([
  'happyhorse-1.1-t2v',
  'happyhorse-1.1-i2v',
  'happyhorse-1.1-r2v'
]);
const WAN3_VIDEO_MODEL_IDS = new Set(['wan3.0-video', 'wan3.0-spicy-video']);
const MINIMAX_H3_VIDEO_MODEL_IDS = new Set([
  'minimax-h3-fl2va-fp8_t2v',
  'minimax-h3-fl2va-fp8_i2v',
  'minimax-h3-fl2va-fp8_flf2v',
  'minimax-h3-ref2va-fp8_r2v',
  'minimax-h3-fl2va-fp8_t2v_turbo',
  'minimax-h3-fl2va-fp8_i2v_turbo',
  'minimax-h3-fl2va-fp8_flf2v_turbo',
  'minimax-h3-ref2va-fp8_r2v_turbo',
  'minimax-h3-fl2va-fp8_t2v_balanced',
  'minimax-h3-fl2va-fp8_i2v_balanced',
  'minimax-h3-fl2va-fp8_flf2v_balanced',
  'minimax-h3-ref2va-fp8_r2v_balanced'
]);

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
    isWanModel(modelId) ||
    isLtx2Model(modelId) ||
    isSeedanceModel(modelId) ||
    isHappyhorseModel(modelId) ||
    isWan3Model(modelId) ||
    isMinimaxH3Model(modelId)
  );
}

/**
 * Check if a model ID is for an audio workflow (e.g., ACE-Step).
 * Audio models produce MP3 output by default.
 */
export function isAudioModel(modelId: string): boolean {
  return modelId.startsWith('ace_step') || modelId === 'minimax_music3';
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
  return WAN_VIDEO_MODEL_IDS.has(modelId);
}

/**
 * Check if a model ID is a WAN animate model (animate-move or animate-replace).
 * These models support up to 321 frames (20s at 16fps).
 */
export function isWanAnimateModel(modelId: string): boolean {
  return (
    isWanModel(modelId) &&
    (modelId === 'wan_v2.2-14b-fp8_animate-move_lightx2v' ||
      modelId === 'wan_v2.2-14b-fp8_animate-replace_lightx2v')
  );
}

/**
 * Check if a model ID is an LTX 2.x video model.
 *
 * LTX 2.x models generate video at the actual specified FPS (1-60 fps range).
 * There is no post-render interpolation - fps directly affects generation.
 *
 * Frame count should be calculated as: duration * fps + 1
 * Additionally, LTX 2.x has a frame step constraint where frames must follow
 * the pattern: 1 + n*8 (i.e., 1, 9, 17, 25, 33, 41, ...)
 *
 * Note: `ltx2-` prefix is kept for backwards compatibility (server translates
 * ltx2- model IDs to ltx23- equivalents).
 */
export function isLtx2Model(modelId: string): boolean {
  return LTX_VIDEO_MODEL_IDS.has(modelId);
}

/**
 * Check if a model ID is a Seedance video model.
 *
 * Seedance models are external API-backed video models that all generate at
 * 24fps. Duration and resolution differ by generation:
 * - `seedance-2-0` / `-mini`: 4-15 second clips; the full model goes up to 4K
 *   while Mini caps at 720p.
 * - `seedance-2-5`: 4-30 second clips, 480p/720p only (no 1080p, no 4K).
 */
export function isSeedanceModel(modelId: string): boolean {
  return SEEDANCE_VIDEO_MODEL_IDS.has(modelId);
}

/**
 * Check if a model ID is a Seedance 2.5 video model.
 *
 * Seedance 2.5 is the only Seedance generation that renders up to 30 seconds in
 * a single call, supports first-and-last-frame conditioning, and accepts the
 * larger 30 image / 10 video / 10 audio reference budget. It is also the only
 * one that cannot render 1080p or 4K.
 */
export function isSeedance25Model(modelId: string): boolean {
  return modelId === 'seedance-2-5';
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
  return HAPPYHORSE_VIDEO_MODEL_IDS.has(modelId);
}

/**
 * Check if a model ID is Alibaba's unified Wan 3 video model.
 *
 * Unlike workflow-specific local WAN 2.2 checkpoints, `wan3.0-video` uses one
 * canonical vendor/model ID for text, first-frame, first-and-last-frame,
 * multimodal reference, edit, and extend requests. The supplied media shape
 * selects the operation; the model ID deliberately carries no workflow suffix.
 */
export function isWan3Model(modelId: string): boolean {
  return WAN3_VIDEO_MODEL_IDS.has(modelId);
}

/** Check for the Wan 3.0 Enhanced model specifically. */
export function isWan3EnhancedModel(modelId: string): boolean {
  return modelId === 'wan3.0-spicy-video';
}

/**
 * Check if a model ID is a MiniMax H3 video model.
 *
 * Two separate checkpoints and dedicated distilled paths ship under this prefix:
 * - FL2VA: `minimax-h3-fl2va-fp8_t2v`, `..._i2v`, and `..._flf2v`
 * - Ref2VA: `minimax-h3-ref2va-fp8_r2v` (the multi-reference workflow)
 * - FL2VA Turbo: the same three FL2VA ids with a `_turbo` suffix
 * - Ref2VA Turbo: `minimax-h3-ref2va-fp8_r2v_turbo`
 * - FL2VA Balanced: the same three FL2VA ids with a `_balanced` suffix
 * - Ref2VA Balanced: `minimax-h3-ref2va-fp8_r2v_balanced`
 *
 * All H3 paths share fixed 24fps, guidance 1, the `124 + n*17` frame grid,
 * and jointly generated 32kHz stereo audio. Standard H3 uses 20 steps;
 * Balanced uses Alibaba PAI's 8-step Parallel Decoding Distillation (PDD)
 * adapters; each Turbo family uses its own 4-step distillation LoRA.
 */
export function isMinimaxH3Model(modelId: string): boolean {
  return MINIMAX_H3_VIDEO_MODEL_IDS.has(modelId);
}

/**
 * Check if a model ID is one of the 4-step MiniMax H3 Turbo workflows.
 * FL2VA covers t2v/i2v/flf2v; Ref2VA uses its dedicated r2v Turbo LoRA.
 */
export function isMinimaxH3TurboModel(modelId: string): boolean {
  return (
    /^minimax-h3-fl2va-fp8_(?:t2v|i2v|flf2v)_turbo$/.test(modelId) ||
    modelId === 'minimax-h3-ref2va-fp8_r2v_turbo'
  );
}

/**
 * Check if a model ID is one of the 8-step MiniMax H3 Balanced workflows.
 * FL2VA covers t2v/i2v/flf2v; Ref2VA uses its matching PDD adapter for r2v.
 */
export function isMinimaxH3BalancedModel(modelId: string): boolean {
  return (
    /^minimax-h3-fl2va-fp8_(?:t2v|i2v|flf2v)_balanced$/.test(modelId) ||
    modelId === 'minimax-h3-ref2va-fp8_r2v_balanced'
  );
}

/**
 * Check if a model ID is the MiniMax H3 Ref2VA multi-reference workflow
 * (`minimax-h3-ref2va-fp8_r2v`, `..._r2v_turbo`, or `..._r2v_balanced`).
 *
 * This is the only MiniMax H3 workflow that conditions on more than two input
 * files, and the only video workflow of any family that carries reference
 * images through the `contextImages` upload slots. Use it wherever the rule is
 * "H3, but only the reference workflow"; `isMinimaxH3Model` covers rules that
 * apply to both H3 checkpoints.
 */
export function isMinimaxH3ReferenceModel(modelId: string): boolean {
  return isMinimaxH3Model(modelId) && getVideoWorkflowType(modelId) === 'r2v';
}

/**
 * Check if a model ID is an external API-backed video model.
 *
 * These vendor families share the external API routing path: Spark-only
 * billing, no negative prompt, and HTTPS/local
 * reference context handling. Use this where the same gate applies to both
 * families; use the model-specific checks (`isSeedanceModel` /
 * `isHappyhorseModel`) for behavior that differs, such as reference asset
 * validation and minimum duration.
 */
export function isExternalApiVideoModel(modelId: string): boolean {
  return isSeedanceModel(modelId) || isHappyhorseModel(modelId) || isWan3Model(modelId);
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
 * ## Standard Behavior (LTX 2.x, Seedance, and future models)
 * - Generate at the actual specified FPS (no interpolation)
 * - Formula: duration * fps + 1
 * - LTX 2.x specific: Frame count must follow the pattern: 1 + n*8
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
    // LTX 2.x and future models: Generate at actual fps
    // This is the standard behavior going forward
    frames = Math.round(duration * fps) + 1;

    // LTX 2.x specific: snap to frame step constraint (1 + n*8)
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

  const isWan = isWanModel(modelId);
  const isLtx2 = isLtx2Model(modelId);
  const isSeedance = isSeedanceModel(modelId);
  const isHappyhorse = isHappyhorseModel(modelId);
  const isWan3 = isWan3Model(modelId);
  const isMinimaxH3 = isMinimaxH3Model(modelId);

  if (!isWan && !isLtx2 && !isSeedance && !isHappyhorse && !isWan3 && !isMinimaxH3) return null;

  // Wan 3 is one unified endpoint whose concrete workflow is selected from
  // its inputs. Return the text-to-video baseline so callers recognize it as
  // a valid video model; input-specific validation is handled separately.
  if (isWan3) return 't2v';

  // HappyHorse encodes the workflow directly in the model id using hyphenated
  // suffixes: happyhorse-1.1-t2v, happyhorse-1.1-i2v, happyhorse-1.1-r2v.
  if (isHappyhorse) {
    if (modelId.includes('-r2v')) return 'r2v';
    if (modelId.includes('-i2v')) return 'i2v';
    if (modelId.includes('-t2v')) return 't2v';
    return null;
  }

  // MiniMax H3 model ids carry the workflow as an underscore suffix on a
  // checkpoint name: minimax-h3-fl2va-fp8_t2v / _i2v / _flf2v and
  // minimax-h3-ref2va-fp8_r2v.
  //
  // Every suffix is matched with its leading underscore, which is what keeps
  // the checkpoint segment out of the match: 'ref2va' contains a bare 'f2v' and
  // 'fl2va' a bare 'l2v', but neither contains '_t2v', '_i2v', '_flf2v', or
  // '_r2v'. Check the longer '_flf2v' before '_i2v'/'_t2v', and check '_r2v'
  // up front so a future suffix cannot shadow it.
  if (isMinimaxH3) {
    if (modelId.includes('_r2v')) return 'r2v';
    if (modelId.includes('_flf2v')) return 'flf2v';
    if (modelId.includes('_i2v')) return 'i2v';
    if (modelId.includes('_t2v')) return 't2v';
    return null;
  }

  // WAN, LTX 2.x, and Seedance models share similar workflow type suffixes
  if (modelId.includes('_i2v')) return 'i2v';
  if (modelId.includes('_t2v')) return 't2v';

  // LTX 2.5/2.3 control and Seedance v2v workflows
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
 *
 * `r2v` is the one workflow type shared by two model families with different
 * asset rules: HappyHorse is image-only, while MiniMax H3 also takes reference
 * video and reference audio. The entry below is the HappyHorse baseline;
 * resolve requirements for a concrete model with
 * `getVideoAssetRequirements(modelId)` rather than indexing this table
 * directly.
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
    // MiniMax H3 r2v has different rules - see MINIMAX_H3_R2V_ASSETS.
    referenceImage: 'optional',
    referenceImageEnd: 'forbidden',
    referenceAudio: 'forbidden',
    referenceAudioIdentity: 'forbidden',
    referenceVideo: 'forbidden',
    referenceMask: 'forbidden'
  }
};

/**
 * MiniMax H3 reference ceilings, taken from the `MiniMaxH3ReferenceToVideo`
 * node: up to 9 reference images, 3 reference videos (24fps, 2-15s each), and
 * 3 reference audio clips, with at most 12 reference files in total. Every H3
 * reference uses the Sogni S3 upload path; see `countMinimaxH3References`.
 */
export const MINIMAX_H3_MAX_REFERENCE_IMAGES = 9;
export const MINIMAX_H3_MAX_REFERENCE_VIDEOS = 3;
export const MINIMAX_H3_MAX_REFERENCE_AUDIOS = 3;
export const MINIMAX_H3_MAX_REFERENCE_FILES = 12;

/**
 * MiniMax H3 `r2v` (Ref2VA) asset requirements - `minimax-h3-ref2va-fp8_r2v`.
 *
 * H3 r2v is a multi-reference workflow, not a frame-anchored one: references
 * are presented to the model as labelled material (`<Picture i>`, `<Video k>`,
 * `<Audio j>`) that the prompt assigns jobs to, rather than being pinned to the
 * first or last frame.
 *
 * Every entry here is a single-file upload slot, so the table alone cannot
 * express r2v's real limits. The full arrays are enforced separately when the
 * job request is built; see
 * `countMinimaxH3References`.
 *
 * ### referenceImage
 * `optional`, because it is just the first entry of an ordered set rather than a
 * required anchor: an r2v project may supply its visual context entirely
 * through reference videos, or its images entirely through `contextImages`.
 * Note that `referenceImage` and `contextImage1` are two
 * SEPARATE reference slots, not two names for one - sending both presents two
 * pictures to the model. `getVideoContextImageSlots` keeps them apart.
 *
 * ### referenceImageEnd
 * Forbidden. r2v has no closing frame - `MiniMaxH3ReferenceToVideo` has no
 * first_frame/last_frame input at all - so an end-frame upload would be paid
 * for and then ignored. Reference image 2 is the next entry in `contextImages`.
 * To interpolate between two anchors, use `minimax-h3-fl2va-fp8_flf2v`.
 *
 * ### referenceVideo and referenceAudio
 * `optional`; the singular fields are the first entries in the uploaded
 * `referenceVideos` / `referenceAudios` sets. The API stores each numbered slot
 * under a distinct S3 key.
 *
 * `referenceAudioIdentity` (LTX-2.3 ID-LoRA) is forbidden even though r2v does
 * take reference audio: H3 has no identity-specific audio input. Send the clip
 * as `referenceAudio` and tell the prompt what to do with it. `referenceMask`
 * (LTX-2.3 v2v inpaint) belongs to another model family.
 */
export const MINIMAX_H3_R2V_ASSETS: Record<VideoAssetKey, AssetRequirement> = {
  referenceImage: 'optional',
  referenceImageEnd: 'forbidden',
  referenceAudio: 'optional',
  referenceAudioIdentity: 'forbidden',
  referenceVideo: 'optional',
  referenceMask: 'forbidden'
};

/**
 * MiniMax H3 `i2v` accepts either endpoint independently, or both together.
 * The generic i2v validation enforces that at least one of `referenceImage`
 * and `referenceImageEnd` is present. The dedicated `flf2v` workflow remains
 * stricter and requires both anchors.
 *
 * Keep this H3-specific table instead of returning the generic i2v table:
 * audio identity is an LTX feature and is not an H3 input.
 */
export const MINIMAX_H3_I2V_ASSETS: Record<VideoAssetKey, AssetRequirement> = {
  referenceImage: 'optional',
  referenceImageEnd: 'optional',
  referenceAudio: 'forbidden',
  referenceAudioIdentity: 'forbidden',
  referenceVideo: 'forbidden',
  referenceMask: 'forbidden'
};

/**
 * One reference image, resolved to the upload slot that carries it.
 */
export interface VideoContextImageSlot {
  /**
   * 1-based `contextImage<slot>` asset slot, matching the `contextImage1`..
   * `contextImage16` upload types and the `hasContextImage<slot>` keyFrame
   * flags.
   */
  slot: number;
  /** The caller-supplied asset for this slot. */
  media: InputMedia;
}

/**
 * Resolve `contextImages` onto the numbered `contextImage<n>` upload slots.
 *
 * MiniMax H3 r2v renders on a Sogni worker, so all references use Sogni's asset
 * upload path. Images travel as the same `referenceImage` / `contextImage<n>`
 * types Qwen-Edit and GPT Image already use for image projects. Sogni Socket compacts
 * them - `referenceImage` first, then `contextImage1`, `contextImage2`, ... in
 * slot order - into the numbered
 * `referenceImage1..9` job fields the ComfyUI worker packs into
 * `ref_images.ref_image_0..8`.
 *
 * Each upload type is its OWN reference: `referenceImage` and `contextImage1`
 * are two pictures, not two spellings of one (the worker de-duplicates only by
 * resolved file path). Offsetting `contextImages` past `referenceImage` when
 * both are present therefore is not collision avoidance - it keeps the mapping
 * one-to-one and readable, so the `<Picture i>` ordinal of every reference is
 * exactly its position in `[referenceImage, ...contextImages]`.
 */
export function getVideoContextImageSlots(
  params: Pick<VideoProjectParams, 'referenceImage' | 'contextImages'>
): VideoContextImageSlot[] {
  const contextImages = params.contextImages;
  if (!Array.isArray(contextImages) || contextImages.length === 0) return [];
  const offset = params.referenceImage ? 1 : 0;
  return contextImages.map((media, index) => ({ slot: offset + index + 1, media }));
}

/**
 * A MiniMax H3 r2v reference census, per kind and in total.
 */
export interface MinimaxH3ReferenceCounts {
  images: number;
  videos: number;
  audios: number;
  total: number;
}

export interface VideoReferenceMediaSlot {
  slot: number;
  media: InputMedia;
}

/**
 * Resolve the ordered H3 reference-video uploads onto referenceVideo1..3.
 */
export function getMinimaxH3ReferenceVideoSlots(
  params: Pick<VideoProjectParams, 'referenceVideo' | 'referenceVideos'>
): VideoReferenceMediaSlot[] {
  return [params.referenceVideo, ...(params.referenceVideos ?? [])]
    .filter((media): media is InputMedia => Boolean(media))
    .map((media, index) => ({ slot: index + 1, media }));
}

/** Resolve the ordered H3 standalone-audio uploads onto referenceAudio1..3. */
export function getMinimaxH3ReferenceAudioSlots(
  params: Pick<VideoProjectParams, 'referenceAudio' | 'referenceAudios'>
): VideoReferenceMediaSlot[] {
  return [params.referenceAudio, ...(params.referenceAudios ?? [])]
    .filter((media): media is InputMedia => Boolean(media))
    .map((media, index) => ({ slot: index + 1, media }));
}

/** Count the files in an uploaded MiniMax H3 r2v reference set. */
export function countMinimaxH3References(params: VideoProjectParams): MinimaxH3ReferenceCounts {
  const images = (params.referenceImage ? 1 : 0) + (params.contextImages?.length ?? 0);
  const videos = getMinimaxH3ReferenceVideoSlots(params).length;
  const audios = getMinimaxH3ReferenceAudioSlots(params).length;
  return { images, videos, audios, total: images + videos + audios };
}

/**
 * Resolve the asset requirements for a concrete video model id.
 *
 * Use this instead of indexing `VIDEO_WORKFLOW_ASSETS` directly: the `r2v`
 * workflow type is shared by HappyHorse, which is image-only, and MiniMax H3,
 * which also takes reference video and reference audio, so the workflow type
 * alone does not determine the rules.
 *
 * @param modelId - The video model ID
 * @returns The asset requirements, or null when the model has no known workflow
 */
export function getVideoAssetRequirements(
  modelId: string
): Record<VideoAssetKey, AssetRequirement> | null {
  const workflowType = getVideoWorkflowType(modelId);
  if (!workflowType) return null;
  if (workflowType === 'r2v' && isMinimaxH3Model(modelId)) {
    return MINIMAX_H3_R2V_ASSETS;
  }
  if (workflowType === 'i2v' && isMinimaxH3Model(modelId)) {
    return MINIMAX_H3_I2V_ASSETS;
  }
  return VIDEO_WORKFLOW_ASSETS[workflowType];
}

/**
 * Whether a `referenceMask` should be honored for the given video params.
 * Only LTX 2.5/2.3 v2v 'inpaint' control consumes a mask.
 */
export function usesReferenceMask(params: VideoProjectParams): boolean {
  return params.controlNet?.name === 'inpaint';
}
