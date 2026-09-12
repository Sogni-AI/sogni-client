import {
  AudioProjectParams,
  ImageProjectParams,
  Sam3ImagePrompt,
  isAudioParams,
  isImageParams,
  isVideoParams,
  Pixal3dTemplateVariant,
  ProjectParams,
  VideoProjectParams
} from './types/index.js';
import {
  ControlNetParams,
  ControlNetParamsRaw,
  VideoControlNetParams,
  VideoControlNetParamsRaw
} from './types/ControlNetParams.js';
import {
  validateNumber,
  validateCustomImageSize,
  validateGptImageOptions,
  validateVideoSize,
  validateTeacacheThreshold,
  isComfyModel,
  validateVideoDuration,
  validateSampler,
  validateScheduler,
  validateVae
} from '../lib/validation.js';
import {
  getVideoWorkflowType,
  getVideoAssetRequirements,
  isVideoModel,
  isVideoUpscaleModel,
  calculateVideoFrames,
  isLtx2Model,
  isWanAnimateModel,
  isSeedanceModel,
  isSeedance25Model,
  isHappyhorseModel,
  isWan3Model,
  isWan3EnhancedModel,
  isMinimaxH3Model,
  isMinimaxH3TurboModel,
  isMinimaxH3BalancedModel,
  isMinimaxH3ReferenceModel,
  isExternalApiVideoModel,
  usesReferenceMask,
  countMinimaxH3References,
  getVideoContextImageSlots,
  getMinimaxH3ReferenceVideoSlots,
  getMinimaxH3ReferenceAudioSlots,
  MINIMAX_H3_MAX_REFERENCE_IMAGES,
  MINIMAX_H3_MAX_REFERENCE_VIDEOS,
  MINIMAX_H3_MAX_REFERENCE_AUDIOS,
  MINIMAX_H3_MAX_REFERENCE_FILES,
  MINIMAX_H3_MIN_DURATION,
  MINIMAX_H3_MAX_DURATION,
  MINIMAX_H3_DIMENSION_STEP,
  MINIMAX_H3_MAX_DIMENSION,
  MINIMAX_H3_MAX_PIXELS,
  MINIMAX_H3_MIN_FRAMES,
  MINIMAX_H3_MAX_FRAMES,
  MINIMAX_H3_FRAME_STEP,
  MINIMAX_H3_BASE_FRAMES,
  isSegmentationModel
} from './utils/index.js';
import { ApiError } from '../ApiClient/index.js';
import {
  AudioModelOptions,
  ImageModelOptions,
  ModelOptions,
  VideoModelOptions
} from './types/ModelOptions.js';
import { workloadAttributionToWireFields } from '../lib/attribution.js';

const SAM3_IMAGE_SEGMENT_WORKFLOW_ID = 'sam3_image_segment_bf16';
const BIREFNET_BACKGROUND_REMOVAL_WORKFLOW_ID = 'birefnet_image_background_removal_fp16';
const PIXAL3D_WORKFLOW_ID = 'pixal3d_int8_i23d';
// The sole graph ComfyUI's workflows/image/manifest.json registers under the
// Pixal3D workflow id. This is a closed list, not a passthrough:
// `templateVariant` is the worker's generic template selector, so
// an open one would let a caller aim a paid job at any graph a worker carries.
const PIXAL3D_DEFAULT_TEMPLATE_VARIANT = 'i23d-birefnet';
const PIXAL3D_TEMPLATE_VARIANTS: Pixal3dTemplateVariant[] = [PIXAL3D_DEFAULT_TEMPLATE_VARIANT];
const MAX_SAM3_POINTS = 32;
const MAX_SAM3_BOXES = 16;
const MAX_SAM3_TEXT_LENGTH = 240;
const MAX_SAM3_INSTANCES = 16;
// Pixal3D reduce-only options. Each max is the shipped default, so a request
// can only ever ask for less work than the flat price already covers; the
// socket and the worker both clamp again.
const PIXAL3D_REDUCE_ONLY_LIMITS: Record<string, { min: number; max: number }> = {
  textureSize: { min: 1024, max: 4096 },
  meshTargetFaces: { min: 5000, max: 700000 },
  normalMapSize: { min: 512, max: 2048 },
  ambientOcclusionSize: { min: 256, max: 1024 },
  shapeResolution: { min: 1024, max: 1536 }
};

// Keep the existing receipt wire shape. Applications select their generation
// recipe; the service decides which requests are eligible for a receipt.
function normalizeWorldGenerationReceipt(receipt: ProjectParams['worldGenerationReceipt']) {
  if (!receipt) return undefined;
  const hash = (value: unknown, field: string) => {
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value)) {
      throw new ApiError(400, {
        status: 'error',
        errorCode: 0,
        message: `worldGenerationReceipt.${field} must be a SHA-256 hex digest.`
      });
    }
    return value.toLowerCase();
  };
  if (receipt.stage === 'target_still') {
    return {
      stage: receipt.stage,
      sourceImageSha256: hash(receipt.sourceImageSha256, 'sourceImageSha256'),
      selectionHash: hash(receipt.selectionHash, 'selectionHash')
    };
  }
  if (receipt.stage === 'transition') {
    return {
      stage: receipt.stage,
      firstFrameSha256: hash(receipt.firstFrameSha256, 'firstFrameSha256'),
      lastFrameSha256: hash(receipt.lastFrameSha256, 'lastFrameSha256')
    };
  }
  throw new ApiError(400, {
    status: 'error',
    errorCode: 0,
    message: 'worldGenerationReceipt.stage must be target_still or transition.'
  });
}

/**
 * Validate that the provided assets match the workflow requirements.
 * Throws an error if required assets are missing or forbidden assets are provided.
 */
function validateVideoWorkflowAssets(params: VideoProjectParams): void {
  validateVideoContextImages(params);
  validateVideoReferenceArrays(params);

  if (isHappyhorseModel(params.modelId)) {
    validateHappyhorseReferenceAssets(params);
    return;
  }
  if (isWan3Model(params.modelId)) {
    validateWan3ReferenceAssets(params);
    return;
  }
  if (isSeedanceModel(params.modelId)) {
    validateSeedanceTaskType(params);
    validateSeedanceReferenceAssets(params);
    return;
  }
  if (isMinimaxH3ReferenceModel(params.modelId)) {
    validateMinimaxH3ReferenceAssets(params);
  } else if (
    params.referenceImageUrls ||
    params.referenceVideoUrls ||
    params.referenceAudioUrls ||
    params.referenceFileUrl ||
    params.referenceLinkUrl
  ) {
    throw new ApiError(400, {
      status: 'error',
      errorCode: 0,
      message:
        'External reference URLs are supported only by Seedance, HappyHorse, and Wan 3 models.'
    });
  }

  const workflowType = getVideoWorkflowType(params.modelId);
  if (!workflowType) return;

  const requirements = getVideoAssetRequirements(params.modelId);
  if (!requirements) return;

  // Special case for i2v: at least ONE of referenceImage or referenceImageEnd required
  if (workflowType === 'i2v') {
    if (!params.referenceImage && !params.referenceImageEnd) {
      throw new ApiError(400, {
        status: 'error',
        errorCode: 0,
        message:
          'i2v workflow requires at least one of referenceImage or referenceImageEnd. Please provide this asset.'
      });
    }
  }

  // sam2Coordinates is only valid for animate-replace workflows
  if (params.sam2Coordinates && workflowType !== 'animate-replace') {
    throw new ApiError(400, {
      status: 'error',
      errorCode: 0,
      message: 'sam2Coordinates is only supported for animate-replace workflows.'
    });
  }

  // Check for missing required assets and forbidden assets
  for (const [asset, requirement] of Object.entries(requirements)) {
    const assetKey = asset as keyof VideoProjectParams;
    const hasAsset = !!params[assetKey];

    if (requirement === 'required' && !hasAsset) {
      throw new ApiError(400, {
        status: 'error',
        errorCode: 0,
        message: `${workflowType} workflow requires ${assetKey}. Please provide this asset.`
      });
    }

    if (requirement === 'forbidden' && hasAsset) {
      throw new ApiError(400, {
        status: 'error',
        errorCode: 0,
        message: `${workflowType} workflow does not support ${assetKey}. Please remove this asset.`
      });
    }
  }
}

function validateSeedanceTaskType(params: VideoProjectParams): void {
  const taskType = params.seedanceTaskType;
  const isSeedance25 = isSeedance25Model(params.modelId);
  if (taskType !== undefined && !new Set(['reference', 'edit', 'extend']).has(taskType as string)) {
    throw new ApiError(400, {
      status: 'error',
      errorCode: 0,
      message: 'seedanceTaskType must be reference, edit, or extend.'
    });
  }
  if (taskType !== undefined && !isSeedance25) {
    throw new ApiError(400, {
      status: 'error',
      errorCode: 0,
      message: 'seedanceTaskType is supported only by Seedance 2.5.'
    });
  }
  if (!isSeedance25) return;

  const hasFrameInput = Boolean(params.referenceImage || params.referenceImageEnd);
  const hasReferenceVideo =
    Boolean(params.referenceVideo) || asReferenceUrlArray(params.referenceVideoUrls).length > 0;
  const hasLooseReference =
    asReferenceUrlArray(params.referenceImageUrls).length > 0 ||
    hasReferenceVideo ||
    Boolean(params.referenceAudio) ||
    asReferenceUrlArray(params.referenceAudioUrls).length > 0;

  if (taskType === undefined && hasLooseReference) {
    throw new ApiError(400, {
      status: 'error',
      errorCode: 0,
      message: 'Seedance 2.5 loose-reference requests require seedanceTaskType.'
    });
  }

  if (taskType !== undefined && hasFrameInput) {
    throw new ApiError(400, {
      status: 'error',
      errorCode: 0,
      message:
        'seedanceTaskType is for Seedance 2.5 loose-reference, edit, or extend requests; omit it for first/last-frame generation.'
    });
  }
  if ((taskType === 'edit' || taskType === 'extend') && !hasReferenceVideo) {
    throw new ApiError(400, {
      status: 'error',
      errorCode: 0,
      message: `Seedance 2.5 ${taskType} requires at least one reference video.`
    });
  }
  if (taskType === 'reference' && !hasLooseReference) {
    throw new ApiError(400, {
      status: 'error',
      errorCode: 0,
      message: `Seedance 2.5 ${taskType} requires at least one loose image, video, or audio reference.`
    });
  }
}

/**
 * `contextImages` shape check for video projects.
 *
 * The field is the video counterpart of the image-project field of the same
 * name and belongs to exactly one video workflow: MiniMax H3 r2v is the only
 * Comfy-native multi-reference video model, and no other video workflow reads
 * the numbered `contextImage<n>` upload slots. Runs before the external-API
 * families are dispatched, since those return early.
 */
function validateVideoContextImages(params: VideoProjectParams): void {
  if (params.contextImages === undefined) return;

  if (!isMinimaxH3ReferenceModel(params.modelId)) {
    throw new ApiError(400, {
      status: 'error',
      errorCode: 0,
      message:
        'contextImages is supported only by the MiniMax H3 r2v workflow (minimax-h3-ref2va-fp8_r2v).'
    });
  }
  if (!Array.isArray(params.contextImages)) {
    throw new ApiError(400, {
      status: 'error',
      errorCode: 0,
      message: 'contextImages must be an array of reference images.'
    });
  }
  if (params.contextImages.some((image) => !image)) {
    throw new ApiError(400, {
      status: 'error',
      errorCode: 0,
      message:
        'contextImages must not contain empty entries. Reference ordinals follow array position, so a hole would renumber every later reference.'
    });
  }
}

function validateVideoReferenceArrays(params: VideoProjectParams): void {
  const fields = ['referenceVideos', 'referenceAudios'] as const;
  for (const field of fields) {
    const value = params[field];
    if (value === undefined) continue;
    if (!isMinimaxH3ReferenceModel(params.modelId)) {
      throw new ApiError(400, {
        status: 'error',
        errorCode: 0,
        message: `${field} is supported only by the MiniMax H3 r2v workflow (minimax-h3-ref2va-fp8_r2v).`
      });
    }
    if (!Array.isArray(value) || value.some((media) => !media)) {
      throw new ApiError(400, {
        status: 'error',
        errorCode: 0,
        message: `${field} must be an array without empty entries.`
      });
    }
  }
  if (params.referenceVideoDurations !== undefined && !isMinimaxH3ReferenceModel(params.modelId)) {
    throw new ApiError(400, {
      status: 'error',
      errorCode: 0,
      message:
        'referenceVideoDurations is supported only by the MiniMax H3 r2v workflow (minimax-h3-ref2va-fp8_r2v).'
    });
  }
}

/**
 * MiniMax H3 `r2v` reference-set validation.
 *
 * r2v takes up to 9 images, 3 videos, 3 audio clips, and 12 files in total.
 * Because it renders on a Sogni worker rather than at an external vendor, every
 * reference uses the S3 upload path. At least one visual reference (image or
 * video) is required; audio alone cannot condition the visual stream.
 */
function validateMinimaxH3ReferenceAssets(params: VideoProjectParams): void {
  for (const field of ['referenceImageUrls', 'referenceVideoUrls', 'referenceAudioUrls'] as const) {
    if (params[field] !== undefined) {
      throw new ApiError(400, {
        status: 'error',
        errorCode: 0,
        message: `MiniMax H3 r2v does not accept ${field}; pass files through the Sogni asset upload fields instead.`
      });
    }
  }

  const references = countMinimaxH3References(params);
  const referenceVideoDurations = params.referenceVideoDurations;
  // Duration hints are optional client-side preflight metadata. When present,
  // validate them early; when omitted, Socket probes the uploaded media and
  // overwrites any claimed values before pricing and admission.
  if (referenceVideoDurations !== undefined) {
    if (
      !Array.isArray(referenceVideoDurations) ||
      referenceVideoDurations.length !== references.videos
    ) {
      throw new ApiError(400, {
        status: 'error',
        errorCode: 0,
        message: `MiniMax H3 r2v referenceVideoDurations must contain one entry for each uploaded reference video (expected ${references.videos}).`
      });
    }
    const durationEpsilon = 0.05;
    let totalDurationSeconds = 0;
    referenceVideoDurations.forEach((duration, index) => {
      if (
        !Number.isFinite(duration) ||
        duration < 2 - durationEpsilon ||
        duration > 15 + durationEpsilon
      ) {
        throw new ApiError(400, {
          status: 'error',
          errorCode: 0,
          message: `MiniMax H3 r2v referenceVideoDurations[${index}] must be between 2 and 15 seconds.`
        });
      }
      totalDurationSeconds += duration;
    });
    if (totalDurationSeconds > 15 + durationEpsilon) {
      throw new ApiError(400, {
        status: 'error',
        errorCode: 0,
        message: `MiniMax H3 r2v reference videos may total at most 15 seconds (got ${totalDurationSeconds}).`
      });
    }
  }
  const ceilings: [number, number, string][] = [
    [references.images, MINIMAX_H3_MAX_REFERENCE_IMAGES, 'reference images'],
    [references.videos, MINIMAX_H3_MAX_REFERENCE_VIDEOS, 'reference videos'],
    [references.audios, MINIMAX_H3_MAX_REFERENCE_AUDIOS, 'reference audios']
  ];
  for (const [count, ceiling, label] of ceilings) {
    if (count > ceiling) {
      throw new ApiError(400, {
        status: 'error',
        errorCode: 0,
        message: `MiniMax H3 r2v supports at most ${ceiling} uploaded ${label} (got ${count}).`
      });
    }
  }
  if (references.total > MINIMAX_H3_MAX_REFERENCE_FILES) {
    throw new ApiError(400, {
      status: 'error',
      errorCode: 0,
      message: `MiniMax H3 r2v supports at most ${MINIMAX_H3_MAX_REFERENCE_FILES} reference files in total (got ${references.total}: ${references.images} image, ${references.videos} video, ${references.audios} audio).`
    });
  }
  if (references.images + references.videos < 1) {
    throw new ApiError(400, {
      status: 'error',
      errorCode: 0,
      message:
        'MiniMax H3 r2v needs at least one uploaded visual reference. Attach an image through referenceImage/contextImages or a video through referenceVideo/referenceVideos. Audio-only requests are not supported; for a prompt-only render use minimax-h3-fl2va-fp8_t2v.'
    });
  }
}

function validateMinimaxH3Params(params: VideoProjectParams): void {
  if (!isMinimaxH3Model(params.modelId)) return;

  const invalid = (message: string): never => {
    throw new ApiError(400, { status: 'error', errorCode: 0, message });
  };
  if (params.fps !== undefined && params.fps !== 24) {
    invalid('MiniMax H3 fps is fixed at 24. Omit fps or set it to 24.');
  }
  const isTurbo = isMinimaxH3TurboModel(params.modelId);
  const isBalanced = isMinimaxH3BalancedModel(params.modelId);
  const expectedSteps = isTurbo ? 4 : isBalanced ? 8 : 20;
  if (params.steps !== undefined && params.steps !== expectedSteps) {
    invalid(
      `MiniMax H3${isTurbo ? ' Turbo' : isBalanced ? ' Balanced' : ''} steps are fixed at ${expectedSteps}.`
    );
  }
  if (params.guidance !== undefined && params.guidance !== 1) {
    invalid('MiniMax H3 guidance is fixed at 1.');
  }
  if (params.negativePrompt?.trim()) {
    invalid('MiniMax H3 has no negative-prompt input. Put requested exclusions in positivePrompt.');
  }
  if (params.frames !== undefined) {
    const frames = Number(params.frames);
    if (
      !Number.isInteger(frames) ||
      frames < MINIMAX_H3_MIN_FRAMES ||
      frames > MINIMAX_H3_MAX_FRAMES ||
      (frames - MINIMAX_H3_BASE_FRAMES) % MINIMAX_H3_FRAME_STEP !== 0
    ) {
      invalid('MiniMax H3 frames must be 124 + n*17 in the inclusive range 124-362.');
    }
  }
  if ((params.width === undefined) !== (params.height === undefined)) {
    invalid('MiniMax H3 width and height must be provided together.');
  }
  if (params.width !== undefined && params.height !== undefined) {
    const width = Number(params.width);
    const height = Number(params.height);
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < MINIMAX_H3_DIMENSION_STEP ||
      height < MINIMAX_H3_DIMENSION_STEP ||
      width > MINIMAX_H3_MAX_DIMENSION ||
      height > MINIMAX_H3_MAX_DIMENSION ||
      width % MINIMAX_H3_DIMENSION_STEP !== 0 ||
      height % MINIMAX_H3_DIMENSION_STEP !== 0 ||
      width * height > MINIMAX_H3_MAX_PIXELS
    ) {
      invalid(
        'MiniMax H3 dimensions must use a 32px grid, stay at or below 1344px per axis, and fit within 1,032,192 pixels.'
      );
    }
  }
  if (params.outputScale !== undefined && params.outputScale !== 1 && params.outputScale !== 2) {
    invalid('MiniMax H3 outputScale must be 1 or 2 (2 delivers 2K output).');
  }
}

/**
 * `outputScale` is MiniMax H3's 2K delivery switch. Other video models have no
 * such stage, so a request for 2K on them is refused up front rather than
 * silently ignored; `1` (the standard size) is harmless anywhere.
 */
function validateOutputScale(params: VideoProjectParams): void {
  if (params.outputScale === undefined || params.outputScale === 1) return;
  if (isMinimaxH3Model(params.modelId)) return;
  throw new ApiError(400, {
    status: 'error',
    errorCode: 0,
    message: 'outputScale is supported only by MiniMax H3 models (2 delivers 2K output).'
  });
}

function asReferenceUrlArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((url): url is string => typeof url === 'string' && url.trim().length > 0);
}

function validateReferenceUrlArray(value: unknown, propertyName: string): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    throw new ApiError(400, {
      status: 'error',
      errorCode: 0,
      message: `${propertyName} must be an array of URL strings.`
    });
  }
  if (value.some((url) => typeof url !== 'string' || url.trim().length === 0)) {
    throw new ApiError(400, {
      status: 'error',
      errorCode: 0,
      message: `${propertyName} must contain only non-empty URL strings.`
    });
  }
}

/**
 * Per-model Seedance loose-reference caps. These mirror
 * `catalogs/seedance-reference-limits.json` in `@sogni-ai/sogni-protocol`,
 * which is the language-neutral source of truth every SDK reads.
 *
 * The caps are NOT uniform across the family: Seedance 2.5 accepts a much
 * larger reference budget than the 2.0 generation, so a single shared bound
 * would silently clamp 2.5 requests down to 2.0's limits.
 */
const SEEDANCE_REFERENCE_LIMITS_BY_MODEL: Record<
  string,
  { images: number; videos: number; audios: number; assets: number }
> = {
  'seedance-2-0': { images: 9, videos: 3, audios: 3, assets: 12 },
  'seedance-2-0-mini': { images: 9, videos: 3, audios: 3, assets: 12 },
  // legacy alias: Seedance 2.0 Fast was retired 2026-08; Mini replaced it
  'seedance-2-0-fast': { images: 9, videos: 3, audios: 3, assets: 12 },
  'seedance-2-5': { images: 30, videos: 10, audios: 10, assets: 50 }
};

function seedanceReferenceLimits(modelId: string): {
  images: number;
  videos: number;
  audios: number;
  assets: number;
} {
  const limits = SEEDANCE_REFERENCE_LIMITS_BY_MODEL[modelId];
  if (!limits) {
    throw new ApiError(400, {
      status: 'error',
      errorCode: 0,
      message: `Unknown Seedance model "${modelId}"; no reference-asset limits are defined for it.`
    });
  }
  return limits;
}

function validateSeedanceReferenceAssets(params: VideoProjectParams): void {
  validateReferenceUrlArray(params.referenceImageUrls, 'referenceImageUrls');
  validateReferenceUrlArray(params.referenceVideoUrls, 'referenceVideoUrls');
  validateReferenceUrlArray(params.referenceAudioUrls, 'referenceAudioUrls');

  const limits = seedanceReferenceLimits(params.modelId);

  const imageCount =
    (params.referenceImage ? 1 : 0) +
    (params.referenceImageEnd ? 1 : 0) +
    asReferenceUrlArray(params.referenceImageUrls).length;
  const videoCount =
    (params.referenceVideo ? 1 : 0) + asReferenceUrlArray(params.referenceVideoUrls).length;
  const audioCount =
    (params.referenceAudio || params.referenceAudioIdentity ? 1 : 0) +
    asReferenceUrlArray(params.referenceAudioUrls).length;
  const totalAssetCount = imageCount + videoCount + audioCount;

  if (imageCount > limits.images) {
    throw new ApiError(400, {
      status: 'error',
      errorCode: 0,
      message: `${params.modelId} supports at most ${limits.images} image assets.`
    });
  }
  if (videoCount > limits.videos) {
    throw new ApiError(400, {
      status: 'error',
      errorCode: 0,
      message: `${params.modelId} supports at most ${limits.videos} video assets.`
    });
  }
  if (audioCount > limits.audios) {
    throw new ApiError(400, {
      status: 'error',
      errorCode: 0,
      message: `${params.modelId} supports at most ${limits.audios} audio assets.`
    });
  }
  if (totalAssetCount > limits.assets) {
    throw new ApiError(400, {
      status: 'error',
      errorCode: 0,
      message: `${params.modelId} supports at most ${limits.assets} total asset files.`
    });
  }
  if (
    !isSeedance25Model(params.modelId) &&
    audioCount > 0 &&
    imageCount === 0 &&
    videoCount === 0
  ) {
    throw new ApiError(400, {
      status: 'error',
      errorCode: 0,
      message: 'Seedance audio references require at least one image or video reference.'
    });
  }
}

/**
 * HappyHorse 1.1 reference validation. HappyHorse is image-only and does not
 * reuse Seedance's reference-video / reference-audio handling:
 * - t2v: no reference images
 * - i2v: exactly one first-frame reference image
 * - r2v: between 1 and 9 reference images
 *
 * Reference images may be supplied as a single local `referenceImage` and/or
 * as `referenceImageUrls` HTTPS references. Reference video, reference audio,
 * audio identity, and a separate end-frame image are all unsupported.
 */
function validateHappyhorseReferenceAssets(params: VideoProjectParams): void {
  validateReferenceUrlArray(params.referenceImageUrls, 'referenceImageUrls');
  validateReferenceUrlArray(params.referenceVideoUrls, 'referenceVideoUrls');
  validateReferenceUrlArray(params.referenceAudioUrls, 'referenceAudioUrls');

  if (params.referenceVideo || asReferenceUrlArray(params.referenceVideoUrls).length > 0) {
    throw new ApiError(400, {
      status: 'error',
      errorCode: 0,
      message: 'HappyHorse models do not support reference video assets.'
    });
  }
  if (
    params.referenceAudio ||
    params.referenceAudioIdentity ||
    asReferenceUrlArray(params.referenceAudioUrls).length > 0
  ) {
    throw new ApiError(400, {
      status: 'error',
      errorCode: 0,
      message: 'HappyHorse models do not support reference audio assets.'
    });
  }
  if (params.referenceImageEnd) {
    throw new ApiError(400, {
      status: 'error',
      errorCode: 0,
      message: 'HappyHorse models do not support a separate end-frame image (referenceImageEnd).'
    });
  }

  const workflowType = getVideoWorkflowType(params.modelId);
  const imageCount =
    (params.referenceImage ? 1 : 0) + asReferenceUrlArray(params.referenceImageUrls).length;

  if (workflowType === 'i2v') {
    if (imageCount !== 1) {
      throw new ApiError(400, {
        status: 'error',
        errorCode: 0,
        message: 'HappyHorse i2v requires exactly one first-frame reference image.'
      });
    }
    return;
  }
  if (workflowType === 'r2v') {
    if (imageCount < 1 || imageCount > 9) {
      throw new ApiError(400, {
        status: 'error',
        errorCode: 0,
        message: 'HappyHorse r2v requires between 1 and 9 reference images.'
      });
    }
    return;
  }
  if (imageCount > 0) {
    throw new ApiError(400, {
      status: 'error',
      errorCode: 0,
      message: 'HappyHorse t2v does not support reference images.'
    });
  }
}

/**
 * Wan 3 uses one model ID for every supported video operation. Frame anchors
 * (`referenceImage` / `referenceImageEnd`) and loose multimodal references are
 * two mutually-exclusive request shapes in the upstream API.
 */
function validateWan3ReferenceAssets(params: VideoProjectParams): void {
  const isEnhanced = isWan3EnhancedModel(params.modelId);
  validateReferenceUrlArray(params.referenceImageUrls, 'referenceImageUrls');
  validateReferenceUrlArray(params.referenceVideoUrls, 'referenceVideoUrls');
  validateReferenceUrlArray(params.referenceAudioUrls, 'referenceAudioUrls');

  for (const [field, value] of [
    ['referenceFileUrl', params.referenceFileUrl],
    ['referenceLinkUrl', params.referenceLinkUrl]
  ] as const) {
    if (value === undefined) continue;
    if (typeof value !== 'string' || !value.trim()) {
      throw new ApiError(400, {
        status: 'error',
        errorCode: 0,
        message: `${field} must be a non-empty public HTTPS URL.`
      });
    }
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:') throw new Error('not HTTPS');
    } catch {
      throw new ApiError(400, {
        status: 'error',
        errorCode: 0,
        message: `${field} must be a valid public HTTPS URL.`
      });
    }
  }

  if (params.referenceFileUrl && params.referenceLinkUrl) {
    throw new ApiError(400, {
      status: 'error',
      errorCode: 0,
      message: 'Wan 3 accepts either one reference file or one reference link, not both.'
    });
  }
  if (isEnhanced && (params.referenceFileUrl || params.referenceLinkUrl)) {
    throw new ApiError(400, {
      status: 'error',
      errorCode: 0,
      message: 'Wan 3.0 Enhanced does not accept document or webpage references.'
    });
  }
  if (params.promptExtend !== undefined && typeof params.promptExtend !== 'boolean') {
    throw new ApiError(400, {
      status: 'error',
      errorCode: 0,
      message: 'Wan 3 promptExtend must be a boolean.'
    });
  }
  if (params.watermark !== undefined && typeof params.watermark !== 'boolean') {
    throw new ApiError(400, {
      status: 'error',
      errorCode: 0,
      message: 'Wan 3 watermark must be a boolean.'
    });
  }
  if (isEnhanced && params.watermark !== undefined) {
    throw new ApiError(400, {
      status: 'error',
      errorCode: 0,
      message: 'Wan 3.0 Enhanced does not expose a watermark option.'
    });
  }
  // smartDuration is retired. It let Wan 3 choose 2-30s AFTER admission, so the
  // quote had to reserve the 30-second maximum for a render that usually came
  // back far shorter — and the Wan 3 Enhanced launch credit settled against that
  // reserved ceiling rather than the delivered video. Send an explicit duration,
  // which covers the identical range and is charged exactly as quoted.
  // The server rejects it too; this only fails faster and closer to the caller.
  if (params.smartDuration !== undefined) {
    throw new ApiError(400, {
      status: 'error',
      errorCode: 0,
      message:
        'Wan 3 smartDuration has been retired. Send an explicit duration between 2 and 30 seconds instead.'
    });
  }
  if (params.fps !== undefined && params.fps !== 30) {
    throw new ApiError(400, {
      status: 'error',
      errorCode: 0,
      message: 'Wan 3 output is fixed at 30 fps.'
    });
  }
  const allowedRatios = new Set(['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16']);
  if (params.ratio !== undefined && !allowedRatios.has(params.ratio)) {
    throw new ApiError(400, {
      status: 'error',
      errorCode: 0,
      message: 'Wan 3 ratio must be adaptive, 16:9, 4:3, 1:1, 3:4, or 9:16.'
    });
  }
  if (params.referenceAudioIdentity || params.referenceMask) {
    throw new ApiError(400, {
      status: 'error',
      errorCode: 0,
      message: 'Wan 3 does not support audio-identity or mask inputs.'
    });
  }
  if (params.seed !== undefined) {
    const seed = Number(params.seed);
    if (!Number.isInteger(seed) || seed < 0 || seed > 2_147_483_647) {
      throw new ApiError(400, {
        status: 'error',
        errorCode: 0,
        message: 'Wan 3 seed must be an integer from 0 through 2147483647.'
      });
    }
  }

  const looseImageCount = asReferenceUrlArray(params.referenceImageUrls).length;
  const videoCount =
    (params.referenceVideo ? 1 : 0) + asReferenceUrlArray(params.referenceVideoUrls).length;
  const audioCount =
    (params.referenceAudio ? 1 : 0) + asReferenceUrlArray(params.referenceAudioUrls).length;
  const hasFrameAnchors = Boolean(params.referenceImage || params.referenceImageEnd);
  const hasDocumentContext = Boolean(params.referenceFileUrl || params.referenceLinkUrl);
  const hasLooseReferences =
    looseImageCount > 0 || videoCount > 0 || audioCount > 0 || hasDocumentContext;

  if (!isEnhanced && params.referenceImageEnd && !params.referenceImage) {
    throw new ApiError(400, {
      status: 'error',
      errorCode: 0,
      message: 'Wan 3 last-frame generation requires a first-frame referenceImage.'
    });
  }
  if (hasFrameAnchors && hasLooseReferences) {
    throw new ApiError(400, {
      status: 'error',
      errorCode: 0,
      message:
        'Wan 3 first/last-frame anchors cannot be combined with loose media, file, or link references.'
    });
  }
  if (looseImageCount > 10) {
    throw new ApiError(400, {
      status: 'error',
      errorCode: 0,
      message: 'Wan 3 supports at most 10 reference images.'
    });
  }
  if (videoCount > 5) {
    throw new ApiError(400, {
      status: 'error',
      errorCode: 0,
      message: 'Wan 3 supports at most 5 reference videos.'
    });
  }
  if (audioCount > 5) {
    throw new ApiError(400, {
      status: 'error',
      errorCode: 0,
      message: 'Wan 3 supports at most 5 reference audio clips.'
    });
  }
  if (!String(params.positivePrompt || '').trim() && !hasFrameAnchors && !hasLooseReferences) {
    throw new ApiError(400, {
      status: 'error',
      errorCode: 0,
      message: 'Wan 3 requires a prompt or at least one media, file, or link input.'
    });
  }
}

function getMaxVideoDuration(modelId: string): number {
  if (isMinimaxH3Model(modelId)) {
    // 362 frames at a fixed 24fps, the top of the H3 frame grid.
    return MINIMAX_H3_MAX_DURATION;
  }
  if (isSeedance25Model(modelId)) {
    // Seedance 2.5 renders up to 30s in a single call; 2.0/Mini cap at 15s.
    return 30;
  }
  if (isWan3Model(modelId)) {
    return 30;
  }
  if (isExternalApiVideoModel(modelId)) {
    return 15;
  }
  if (isLtx2Model(modelId) || isWanAnimateModel(modelId)) {
    return 20;
  }
  return 10;
}

// Mac worker can't process the data if some of the fields are missing, so we need to provide a default template
function getTemplate() {
  return {
    selectedUpscalingModel: 'OFF',
    cnVideoFramesSketch: [],
    cnVideoFramesSegmentedSubject: [],
    cnVideoFramesFace: [],
    doCanvasBlending: false,
    animationIsOn: false,
    cnVideoFramesBoth: [],
    cnVideoFramesDepth: [],
    keyFrames: [
      {
        stepsIsEnabled: true,
        siRotation: 0,
        siDragOffsetIsEnabled: true,
        strength: 0.5,
        siZoomScaleIsEnabled: true,
        isEnabled: true,
        processing: 'CPU, GPU',
        useLastImageAsGuideImageInAnimation: true,
        guidanceScaleIsEnabled: true,
        siImageBackgroundColor: 'black',
        cnDragOffset: [0, 0],
        scheduler: null,
        timeStepSpacing: null,
        steps: 20,
        cnRotation: 0,
        guidanceScale: 7.5,
        siZoomScale: 1,
        modelID: '',
        cnRotationIsEnabled: true,
        negativePrompt: '',
        startingImageZoomPanIsOn: false,
        seed: undefined,
        siRotationIsEnabled: true,
        cnImageBackgroundColor: 'clear',
        strengthIsEnabled: true,
        siDragOffset: [0, 0],
        useLastImageAsCNImageInAnimation: false,
        positivePrompt: '',
        controlNetZoomPanIsOn: false,
        cnZoomScaleIsEnabled: true,
        currentControlNets: null,
        stylePrompt: '',
        cnDragOffsetIsEnabled: true,
        frameIndex: 0,
        startingImage: null,
        cnZoomScale: 1
      }
    ],
    previews: 5,
    frameRate: 24,
    generatedVideoSeconds: 10,
    canvasIsOn: false,
    cnVideoFrames: [],
    disableSafety: false,
    cnVideoFramesSegmentedBackground: [],
    cnVideoFramesSegmented: [],
    numberOfImages: 1,
    cnVideoFramesPose: [],
    jobID: '',
    siVideoFrames: []
  };
}

function getControlNet(params: ControlNetParams): ControlNetParamsRaw[] {
  const cn: ControlNetParamsRaw = {
    name: params.name,
    cnImageState: 'original',
    hasImage: !!params.image
  };
  if (params.strength !== undefined) {
    cn.controlStrength = validateNumber(params.strength, {
      min: 0,
      max: 1,
      propertyName: 'strength'
    });
  }
  if (params.mode) {
    switch (params.mode) {
      case 'balanced':
        cn.controlMode = 0;
        break;
      case 'prompt_priority':
        cn.controlMode = 1;
        break;
      case 'cn_priority':
        cn.controlMode = 2;
        break;
      default:
        throw new Error(`Invalid control mode ${params.mode}`);
    }
  }
  if (params.guidanceStart !== undefined) {
    cn.controlGuidanceStart = validateNumber(params.guidanceStart, {
      min: 0,
      max: 1,
      propertyName: 'guidanceStart'
    });
  }
  if (params.guidanceEnd !== undefined) {
    cn.controlGuidanceEnd = validateNumber(params.guidanceEnd, {
      min: 0,
      max: 1,
      propertyName: 'guidanceEnd'
    });
  }
  return [cn];
}

function getVideoControlNet(params: VideoControlNetParams): VideoControlNetParamsRaw[] {
  const cn: VideoControlNetParamsRaw = {
    name: params.name
  };
  if (params.strength !== undefined) {
    cn.controlStrength = validateNumber(params.strength, {
      min: 0,
      max: 1,
      propertyName: 'strength'
    });
  }
  return [cn];
}

function normalizeSam3Prompt(
  prompt: Sam3ImagePrompt
  // multimask is emitted only on the point path, so it stays optional here.
): Required<Pick<Sam3ImagePrompt, 'points' | 'boxes' | 'threshold' | 'applyMask'>> &
  Pick<Sam3ImagePrompt, 'text' | 'multimask' | 'maxInstances'> {
  if (!prompt || typeof prompt !== 'object' || Array.isArray(prompt)) {
    throw new Error('sam3Prompt must be an object');
  }
  const allowedRootKeys = new Set([
    'points',
    'boxes',
    'text',
    'threshold',
    'multimask',
    'applyMask',
    'maxInstances'
  ]);
  const unknownRootKeys = Object.keys(prompt).filter((key) => !allowedRootKeys.has(key));
  if (unknownRootKeys.length > 0) {
    throw new Error(`sam3Prompt contains unsupported fields: ${unknownRootKeys.join(', ')}`);
  }
  const coordinate = (value: unknown, field: string) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(`${field} must be a finite normalized coordinate from 0 to 1`);
    }
    return value;
  };

  const points = prompt.points || [];
  if (!Array.isArray(points) || points.length > MAX_SAM3_POINTS) {
    throw new Error(`sam3Prompt.points must contain at most ${MAX_SAM3_POINTS} entries`);
  }
  const normalizedPoints = points.map((point, index) => {
    if (!point || typeof point !== 'object' || Array.isArray(point)) {
      throw new Error(`sam3Prompt.points[${index}] must be an object`);
    }
    const unknown = Object.keys(point).filter((key) => !['x', 'y', 'label'].includes(key));
    if (unknown.length > 0) {
      throw new Error(`sam3Prompt.points[${index}] contains unsupported fields`);
    }
    if (point.label !== 'positive' && point.label !== 'negative') {
      throw new Error(`sam3Prompt.points[${index}].label must be "positive" or "negative"`);
    }
    return {
      x: coordinate(point.x, `sam3Prompt.points[${index}].x`),
      y: coordinate(point.y, `sam3Prompt.points[${index}].y`),
      label: point.label
    };
  });

  const boxes = prompt.boxes || [];
  if (!Array.isArray(boxes) || boxes.length > MAX_SAM3_BOXES) {
    throw new Error(`sam3Prompt.boxes must contain at most ${MAX_SAM3_BOXES} entries`);
  }
  const normalizedBoxes = boxes.map((box, index) => {
    if (!box || typeof box !== 'object' || Array.isArray(box)) {
      throw new Error(`sam3Prompt.boxes[${index}] must be an object`);
    }
    const unknown = Object.keys(box).filter(
      (key) => !['x0', 'y0', 'x1', 'y1', 'label'].includes(key)
    );
    if (unknown.length > 0) {
      throw new Error(`sam3Prompt.boxes[${index}] contains unsupported fields`);
    }
    if (box.label !== undefined && box.label !== 'positive' && box.label !== 'negative') {
      throw new Error(`sam3Prompt.boxes[${index}].label must be "positive" or "negative"`);
    }
    const normalized = {
      x0: coordinate(box.x0, `sam3Prompt.boxes[${index}].x0`),
      y0: coordinate(box.y0, `sam3Prompt.boxes[${index}].y0`),
      x1: coordinate(box.x1, `sam3Prompt.boxes[${index}].x1`),
      y1: coordinate(box.y1, `sam3Prompt.boxes[${index}].y1`),
      // Boxes have always been positive exemplars, so an absent label leaves
      // every existing caller on exactly its current behavior.
      label: box.label === undefined ? ('positive' as const) : box.label
    };
    if (normalized.x0 >= normalized.x1 || normalized.y0 >= normalized.y1) {
      throw new Error(`sam3Prompt.boxes[${index}] must have x0 < x1 and y0 < y1`);
    }
    return normalized;
  });

  let text: string | undefined;
  if (prompt.text !== undefined) {
    if (typeof prompt.text !== 'string') throw new Error('sam3Prompt.text must be a string');
    text = prompt.text.trim();
    if (!text || text.length > MAX_SAM3_TEXT_LENGTH) {
      throw new Error(`sam3Prompt.text must contain 1 to ${MAX_SAM3_TEXT_LENGTH} characters`);
    }
  }
  if (normalizedPoints.length === 0 && normalizedBoxes.length === 0 && !text) {
    throw new Error('sam3Prompt requires at least one point, box, or text prompt');
  }
  if (text && normalizedPoints.length > 0) {
    throw new Error('sam3Prompt cannot combine text and point prompts');
  }
  if (normalizedPoints.length > 0 && normalizedBoxes.length > 1) {
    throw new Error('sam3Prompt supports at most one box when point prompts are present');
  }
  // SAM 3 takes an exclusion exemplar only alongside a text prompt; the
  // interactive point path has no way to express one.
  if (normalizedPoints.length > 0 && normalizedBoxes.some((box) => box.label === 'negative')) {
    throw new Error('sam3Prompt negative boxes require a text prompt');
  }
  if (
    prompt.threshold !== undefined &&
    (typeof prompt.threshold !== 'number' ||
      !Number.isFinite(prompt.threshold) ||
      prompt.threshold < 0 ||
      prompt.threshold > 1)
  ) {
    throw new Error('sam3Prompt.threshold must be a finite number from 0 to 1');
  }
  if (prompt.multimask !== undefined && typeof prompt.multimask !== 'boolean') {
    throw new Error('sam3Prompt.multimask must be a boolean');
  }
  // multimask chooses among SAM's whole/part/subpart candidates for one
  // ambiguous click, so it only means anything on the point path. Asking for it
  // without points is a mistake worth naming; explicitly declining it is not,
  // and rejecting `false` refuses a request that already says what the text path
  // does anyway. That cost a caller a working selection: the throw surfaced as
  // the generic "a worker couldn't complete this generation", which reads as a
  // capacity problem rather than a rejected field.
  if (prompt.multimask === true && normalizedPoints.length === 0) {
    throw new Error('sam3Prompt.multimask requires point prompts');
  }
  if (prompt.applyMask !== undefined && typeof prompt.applyMask !== 'boolean') {
    throw new Error('sam3Prompt.applyMask must be a boolean');
  }
  if (
    prompt.maxInstances !== undefined &&
    (!Number.isSafeInteger(prompt.maxInstances) ||
      prompt.maxInstances < 1 ||
      prompt.maxInstances > MAX_SAM3_INSTANCES)
  ) {
    throw new Error(`sam3Prompt.maxInstances must be an integer from 1 to ${MAX_SAM3_INSTANCES}`);
  }
  return {
    points: normalizedPoints,
    boxes: normalizedBoxes,
    ...(text ? { text } : {}),
    threshold: prompt.threshold === undefined ? 0.5 : prompt.threshold,
    ...(normalizedPoints.length > 0
      ? { multimask: prompt.multimask === undefined ? true : prompt.multimask }
      : {}),
    applyMask: prompt.applyMask === true,
    ...(prompt.maxInstances === undefined ? {} : { maxInstances: prompt.maxInstances })
  };
}

function applyImageParams(
  inputKeyframe: Record<string, any>,
  params: ImageProjectParams,
  options: ImageModelOptions
) {
  const keyFrame: Record<string, any> = {
    ...inputKeyframe,
    sizePreset: params.sizePreset
  };
  const contextImages = params.contextImages || [];
  for (let index = 1; index <= 16; index += 1) {
    keyFrame[`hasContextImage${index}`] = !!contextImages[index - 1];
  }
  // Sampler/scheduler handling: SDK validates and passes through as-is.
  // sogni-socket normalizes values for both ComfyUI and Forge workers.
  if (isComfyModel(params.modelId)) {
    // ComfyUI models use comfySampler/comfyScheduler fields
    keyFrame.comfySampler = validateSampler(params.sampler, options);
    keyFrame.comfyScheduler = validateScheduler(params.scheduler, options);
    keyFrame.vae = validateVae(params.vae, options);
  } else {
    // Legacy Forge models use scheduler/timeStepSpacing fields
    keyFrame.scheduler = validateSampler(params.sampler, options);
    keyFrame.timeStepSpacing = validateScheduler(params.scheduler, options);
  }

  if (params.startingImage) {
    keyFrame.hasStartingImage = true;
    keyFrame.strengthIsEnabled = true;
    keyFrame.strength = 1 - (Number(params.startingImageStrength) || 0.5);
  }

  if (params.modelId === SAM3_IMAGE_SEGMENT_WORKFLOW_ID) {
    if (!params.startingImage) {
      throw new Error('SAM3 image segmentation requires startingImage');
    }
    if (!params.sam3Prompt) {
      throw new Error('SAM3 image segmentation requires sam3Prompt');
    }
    keyFrame.sam3Prompt = normalizeSam3Prompt(params.sam3Prompt);
  } else if (params.sam3Prompt !== undefined) {
    throw new Error(`sam3Prompt is only supported by ${SAM3_IMAGE_SEGMENT_WORKFLOW_ID}`);
  }
  // BiRefNet background removal. One source image, no prompt, and one option:
  // the bare foreground matte, or that matte carried as the source image's
  // alpha channel. SAM 3's applyMask is a different field on a different model,
  // nested inside sam3Prompt, and the two are never read from the same place.
  if (params.modelId === BIREFNET_BACKGROUND_REMOVAL_WORKFLOW_ID) {
    if (!params.startingImage) {
      throw new Error('BiRefNet background removal requires startingImage');
    }
    if (params.applyMask !== undefined && typeof params.applyMask !== 'boolean') {
      throw new Error('applyMask must be a boolean');
    }
    keyFrame.applyMask = params.applyMask === true;
  } else if (params.applyMask !== undefined) {
    throw new Error(`applyMask is only supported by ${BIREFNET_BACKGROUND_REMOVAL_WORKFLOW_ID}`);
  }
  if (params.modelId === PIXAL3D_WORKFLOW_ID && !params.startingImage) {
    throw new Error('Pixal3D reconstruction requires startingImage');
  }
  // Which of the two Pixal3D graphs to run. Unset is not the same as naming the
  // default: a worker resolves only the variants its own manifest declares, so
  // an unset field lets each worker run its own shipped default, while naming
  // one pins the graph for callers that need the other path.
  if (params.templateVariant !== undefined) {
    if (params.modelId !== PIXAL3D_WORKFLOW_ID) {
      throw new Error(`templateVariant is only supported by ${PIXAL3D_WORKFLOW_ID}`);
    }
    if (!PIXAL3D_TEMPLATE_VARIANTS.includes(params.templateVariant)) {
      throw new Error(`templateVariant must be one of: ${PIXAL3D_TEMPLATE_VARIANTS.join(', ')}`);
    }
    keyFrame.templateVariant = params.templateVariant;
  }
  for (const [key, limit] of Object.entries(PIXAL3D_REDUCE_ONLY_LIMITS)) {
    const requested = (params as Record<string, any>)[key];
    if (requested === undefined) continue;
    if (params.modelId !== PIXAL3D_WORKFLOW_ID) {
      throw new Error(`${key} is only supported by ${PIXAL3D_WORKFLOW_ID}`);
    }
    if (!Number.isSafeInteger(requested) || requested < limit.min || requested > limit.max) {
      throw new Error(`${key} must be an integer from ${limit.min} to ${limit.max}`);
    }
    keyFrame[key] = requested;
  }

  if (params.controlNet) {
    keyFrame.currentControlNetsJob = getControlNet(params.controlNet);
  }

  // Set sizePreset to 'custom' if width/height are provided but sizePreset is not set
  let effectiveSizePreset = params.sizePreset;
  if (params.width && params.height && !params.sizePreset) {
    effectiveSizePreset = 'custom';
  }
  keyFrame.sizePreset = effectiveSizePreset;

  if (effectiveSizePreset === 'custom' && params.width && params.height) {
    keyFrame.width = validateCustomImageSize(params.width, {
      modelId: params.modelId,
      propertyName: 'Width'
    });
    keyFrame.height = validateCustomImageSize(params.height, {
      modelId: params.modelId,
      propertyName: 'Height'
    });
  }
  validateGptImageOptions(params);
  if (params.gptImageMask) {
    keyFrame.hasReferenceMask = true;
    keyFrame.referenceMaskContentType = 'image/png';
  }
  if (params.gptImageMaskUrl !== undefined) {
    keyFrame.gptImageMaskUrl = params.gptImageMaskUrl;
  }
  if (params.gptImageQuality !== undefined) {
    keyFrame.gptImageQuality = params.gptImageQuality;
  }
  if (params.gptImageBackground !== undefined) {
    keyFrame.gptImageBackground = params.gptImageBackground;
  }
  if (params.gptImageOutputCompression !== undefined) {
    keyFrame.gptImageOutputCompression = params.gptImageOutputCompression;
  }
  return keyFrame;
}

const VIDEO_UPSCALE_TIMING_ERROR =
  'Omit the source timing, or supply the source video’s exact frame count and frame rate.';

/**
 * FlashVSR source timing is optional. The server probes the uploaded video and
 * adopts its exact frame count and frame rate when they are omitted; values a
 * caller does send must describe the source and are checked against it.
 *
 * These are sanity checks only. The SDK sets no maximum frame count or clip
 * length: the server's admission check is the one place that limit lives, and
 * it refuses a source that is too long with a clear error.
 */
function validateVideoUpscaleTiming(params: VideoProjectParams): void {
  const fps = params.fps === undefined ? undefined : Number(params.fps);
  if (fps !== undefined && (!Number.isFinite(fps) || fps < 1 || fps > 60)) {
    throw new Error(VIDEO_UPSCALE_TIMING_ERROR);
  }
  let frames = params.frames;
  if (frames === undefined && params.duration !== undefined) {
    // A duration identifies the source's frames only together with its exact rate.
    if (fps === undefined) throw new Error(VIDEO_UPSCALE_TIMING_ERROR);
    frames = Math.round(Number(params.duration) * fps);
  }
  if (frames === undefined) return;
  if (!Number.isInteger(frames) || frames < 1) {
    throw new Error(VIDEO_UPSCALE_TIMING_ERROR);
  }
}

function applyVideoParams(
  inputKeyframe: Record<string, any>,
  params: VideoProjectParams,
  options: VideoModelOptions
) {
  if (!isVideoModel(params.modelId)) {
    throw new ApiError(400, {
      status: 'error',
      errorCode: 0,
      message: 'Video generation is only supported for video models.'
    });
  }
  validateVideoWorkflowAssets(params);
  if (isVideoUpscaleModel(params.modelId)) {
    if (
      params.detailPreference != null &&
      !['stable', 'sharper'].includes(params.detailPreference)
    ) {
      throw new Error('FlashVSR detailPreference must be stable or sharper.');
    }
    if (params.processingSpeed != null && !['stable', 'faster'].includes(params.processingSpeed)) {
      throw new Error('FlashVSR processingSpeed must be stable or faster.');
    }
    const seed = params.seed ?? 0;
    if (!Number.isInteger(seed) || seed < -1 || seed > 4294967295) {
      throw new Error('FlashVSR seed must be -1 (random) or an integer from 0 through 4294967295.');
    }
    const resolution =
      params.upscaleResolution ?? Math.min(Number(params.width), Number(params.height));
    if (![1080, 1440].includes(resolution))
      throw new Error('Choose 1080p or 1440p for video upscaling.');
    if (!params.referenceVideo) throw new Error('FlashVSR requires an uploaded referenceVideo.');
    validateVideoUpscaleTiming(params);
    if (params.positivePrompt?.trim() || params.negativePrompt?.trim())
      throw new Error('FlashVSR is promptless.');
    if (
      params.teacacheThreshold != null ||
      params.trimEndFrame ||
      params.controlNet ||
      params.videoStart != null ||
      params.referenceVideoUrls?.length ||
      params.referenceImageUrls?.length ||
      params.referenceAudioUrls?.length ||
      params.referenceFileUrl ||
      params.referenceLinkUrl ||
      params.generateAudio === false
    ) {
      throw new Error(
        'Video upscaling preserves the complete source video and its audio; generation controls are unsupported.'
      );
    }
    if (params.numberOfMedia !== 1) throw new Error('Upscale one source video per project.');
  }
  validateMinimaxH3Params(params);
  validateOutputScale(params);
  const keyFrame: Record<string, any> = { ...inputKeyframe };
  if (params.referenceImage) {
    keyFrame.hasReferenceImage = true;
  }
  // MiniMax H3 r2v reference images 2-9 (or 1-9 without a referenceImage).
  // These are the same numbered upload slots image projects use, and the server
  // turns each flag into a signed download the worker reads back as
  // `contextImage<slot>`.
  for (const { slot } of getVideoContextImageSlots(params)) {
    keyFrame[`hasContextImage${slot}`] = true;
  }
  const referenceImageUrls = asReferenceUrlArray(params.referenceImageUrls);
  if (referenceImageUrls.length) keyFrame.referenceImageURLs = referenceImageUrls;
  if (params.referenceImageEnd) {
    keyFrame.hasReferenceImageEnd = true;
  }
  if (isMinimaxH3ReferenceModel(params.modelId)) {
    for (const { slot } of getMinimaxH3ReferenceAudioSlots(params)) {
      keyFrame[`hasReferenceAudio${slot}`] = true;
    }
  } else if (params.referenceAudio) {
    keyFrame.hasReferenceAudio = true;
  }
  const referenceAudioUrls = asReferenceUrlArray(params.referenceAudioUrls);
  if (referenceAudioUrls.length) {
    keyFrame.referenceAudioURLs = referenceAudioUrls;
  }
  if (isMinimaxH3ReferenceModel(params.modelId)) {
    for (const { slot } of getMinimaxH3ReferenceVideoSlots(params)) {
      keyFrame[`hasReferenceVideo${slot}`] = true;
      const durationSeconds = params.referenceVideoDurations?.[slot - 1];
      if (durationSeconds !== undefined) {
        keyFrame[`referenceVideo${slot}DurationSeconds`] = durationSeconds;
      }
    }
  } else if (params.referenceVideo) {
    keyFrame.hasReferenceVideo = true;
  }
  if (params.referenceMask && usesReferenceMask(params)) {
    keyFrame.hasReferenceMask = true;
  }
  const referenceVideoUrls = asReferenceUrlArray(params.referenceVideoUrls);
  if (referenceVideoUrls.length) {
    keyFrame.referenceVideoURLs = referenceVideoUrls;
  }
  if (params.referenceAudioIdentity) {
    keyFrame.hasReferenceAudioIdentity = true;
  }
  if (params.generateAudio !== undefined) {
    keyFrame.generateAudio = params.generateAudio;
  }
  if (params.referenceFileUrl !== undefined) {
    keyFrame.referenceFileURL = params.referenceFileUrl;
  }
  if (params.referenceLinkUrl !== undefined) {
    keyFrame.referenceLinkURL = params.referenceLinkUrl;
  }
  if (params.promptExtend !== undefined) {
    keyFrame.promptExtend = params.promptExtend;
  }
  if (params.watermark !== undefined) {
    keyFrame.watermark = params.watermark;
  }
  if (params.ratio !== undefined) {
    keyFrame.ratio = params.ratio;
  }
  if (params.seedanceTaskType !== undefined) {
    keyFrame.seedanceTaskType = params.seedanceTaskType;
  }
  if (params.audioIdentityStrength !== undefined) {
    keyFrame.identityGuidanceScale = params.audioIdentityStrength;
  }

  // Video generation parameters
  // Note: fps must be processed before duration to correctly calculate frames for LTX 2.x models
  if (params.fps !== undefined) {
    keyFrame.fps = params.fps;
  } else if (isWan3Model(params.modelId)) {
    keyFrame.fps = 30;
  } else if (isExternalApiVideoModel(params.modelId) || isMinimaxH3Model(params.modelId)) {
    keyFrame.fps = 24;
  }
  if (params.frames !== undefined) {
    keyFrame.frames = params.frames;
  }
  if (
    params.duration !== undefined &&
    !(isVideoUpscaleModel(params.modelId) && params.frames !== undefined)
  ) {
    // Minimum direct-SDK duration: MiniMax H3 5.167s (124 frames at 24fps,
    // the bottom of its frame grid), HappyHorse 3s, Seedance 4s, others 1s.
    const minDuration = isVideoUpscaleModel(params.modelId)
      ? 1 / (params.fps ?? 24)
      : isMinimaxH3Model(params.modelId)
        ? MINIMAX_H3_MIN_DURATION
        : isWan3Model(params.modelId)
          ? 2
          : isHappyhorseModel(params.modelId)
            ? 3
            : isSeedanceModel(params.modelId)
              ? 4
              : 1;
    // FlashVSR has no client-side maximum: the server's admission check owns
    // the longest source it accepts and refuses a longer one itself.
    const duration = isVideoUpscaleModel(params.modelId)
      ? validateNumber(params.duration, { min: minDuration, propertyName: 'Video duration' })
      : validateVideoDuration(params.duration, minDuration, getMaxVideoDuration(params.modelId));
    // Use fps from params or default based on model type:
    // - WAN 2.2: fps doesn't affect frame count (always generates at 16fps)
    // - LTX 2.x: fps directly affects frame count (default 24fps if not specified)
    // - Seedance / HappyHorse: fixed 24fps external API generation
    const fps = params.fps ?? (isWan3Model(params.modelId) ? 30 : 24);
    keyFrame.frames = calculateVideoFrames(params.modelId, duration, fps);
  }
  if (params.shift !== undefined) {
    keyFrame.shift = params.shift;
  }
  // MiniMax H3 2K delivery. Sent only when requested, so every other request
  // (and the worker payload the socket builds from it) stays byte-identical.
  if (params.outputScale === 2) {
    keyFrame.outputScale = 2;
  }
  if (params.teacacheThreshold !== undefined) {
    const validatedThreshold = validateTeacacheThreshold(params.teacacheThreshold);
    if (validatedThreshold !== undefined) {
      keyFrame.teacacheThreshold = validatedThreshold;
    }
  }

  // S2V audio parameters
  if (params.audioStart !== undefined) {
    keyFrame.audioStart = params.audioStart;
  }
  if (params.audioDuration !== undefined) {
    keyFrame.audioDuration = params.audioDuration;
  }

  // Animate video parameters (for animate-move, animate-replace)
  if (params.videoStart !== undefined) {
    keyFrame.videoStart = params.videoStart;
  }

  // SAM2 subject detection coordinates for animate-replace workflows
  if (params.sam2Coordinates !== undefined) {
    keyFrame.sam2Coordinates = JSON.stringify(params.sam2Coordinates);
  }

  // Frame trimming for seamless stitching of transition videos
  if (params.trimEndFrame) {
    keyFrame.trimEndFrame = true;
  }

  // First/last frame strengths for LTX-2.3 keyframe interpolation (when referenceImageEnd is provided)
  if (params.firstFrameStrength !== undefined) {
    keyFrame.firstFrameStrength = params.firstFrameStrength;
  }
  if (params.lastFrameStrength !== undefined) {
    keyFrame.lastFrameStrength = params.lastFrameStrength;
  }

  // Control parameters for LTX 2.5/2.3 v2v workflows
  if (params.controlNet) {
    keyFrame.currentControlNetsJob = getVideoControlNet(params.controlNet);
  }

  // Detailer LoRA strength for LTX 2.5/2.3 v2v IC-Control workflows
  if (params.detailerStrength !== undefined) {
    keyFrame.detailerStrength = params.detailerStrength;
  }

  // Validate and set video dimensions (minimum 480px for Wan 2.2 models)
  if (params.width && params.height) {
    if (isMinimaxH3Model(params.modelId)) {
      keyFrame.width = Number(params.width);
      keyFrame.height = Number(params.height);
    } else {
      keyFrame.width = validateVideoSize(params.width, 'width');
      keyFrame.height = validateVideoSize(params.height, 'height');
    }
  }

  // Outpaint canvas anchor for distilled LTX 2.5 or LTX 2.3 v2v workflows
  if (params.outpaintPosition !== undefined) {
    keyFrame.outpaintPosition = params.outpaintPosition;
  }

  keyFrame.comfySampler = validateSampler(params.sampler, options);
  keyFrame.comfyScheduler = validateScheduler(params.scheduler, options);

  if (isVideoUpscaleModel(params.modelId)) {
    keyFrame.upscaleResolution =
      params.upscaleResolution ?? Math.min(Number(params.width), Number(params.height));
    keyFrame.steps = 1;
    keyFrame.seed = params.seed ?? 0;
    keyFrame.detailPreference = params.detailPreference ?? 'stable';
    keyFrame.processingSpeed = params.processingSpeed ?? 'stable';
    keyFrame.generateAudio = true;
    keyFrame.interpolation = 'none';
  }

  return keyFrame;
}

function applyAudioParams(
  inputKeyframe: Record<string, any>,
  params: AudioProjectParams,
  options: AudioModelOptions
) {
  const keyFrame: Record<string, any> = { ...inputKeyframe };

  if (params.duration !== undefined) {
    keyFrame.duration = params.duration;
  }
  if (params.bpm !== undefined) {
    keyFrame.bpm = params.bpm;
  }
  if (params.timesignature !== undefined) {
    keyFrame.timesignature = params.timesignature;
  }
  if (params.language !== undefined) {
    keyFrame.language = params.language;
  }
  if (params.lyrics !== undefined) {
    keyFrame.lyrics = params.lyrics;
  }
  if (params.keyscale !== undefined) {
    keyFrame.keyscale = params.keyscale;
  }
  if (params.composerMode !== undefined) {
    keyFrame.composerMode = params.composerMode;
  }
  if (params.promptStrength !== undefined) {
    keyFrame.promptStrength = params.promptStrength;
  }
  if (params.creativity !== undefined) {
    keyFrame.creativity = params.creativity;
  }
  if (params.shift !== undefined) {
    keyFrame.shift = params.shift;
  }
  // Speech controls. sogni-socket rejects each of these for the audio models
  // that have no node for it, so they are passed through rather than filtered
  // by model id here - one less place for a new speech model to be forgotten.
  if (params.speaker !== undefined) {
    keyFrame.speaker = params.speaker;
  }
  if (params.instruct !== undefined) {
    keyFrame.instruct = params.instruct;
  }
  if (params.referenceText !== undefined) {
    keyFrame.referenceText = params.referenceText;
  }
  if (params.referenceAudio) {
    keyFrame.hasReferenceAudio = true;
  }

  keyFrame.comfySampler = validateSampler(params.sampler, options);
  keyFrame.comfyScheduler = validateScheduler(params.scheduler, options);

  return keyFrame;
}

function createJobRequestMessage(id: string, params: ProjectParams, options: ModelOptions) {
  const template = getTemplate();
  const worldGenerationReceipt = normalizeWorldGenerationReceipt(params.worldGenerationReceipt);
  const negativePrompt =
    isImageParams(params) ||
    (isVideoParams(params) &&
      !isExternalApiVideoModel(params.modelId) &&
      !isMinimaxH3Model(params.modelId))
      ? params.negativePrompt
      : undefined;
  // Base keyFrame with common params
  let keyFrame: Record<string, any> = {
    ...template.keyFrames[0],
    steps: params.steps,
    guidanceScale: params.guidance,
    modelID: params.modelId,
    seed: params.seed,
    positivePrompt: params.positivePrompt,
    // Only include optional prompts if they have actual non-empty values
    // This allows the server to use its defaults when not specified
    ...(negativePrompt && { negativePrompt }),
    ...(params.stylePrompt && { stylePrompt: params.stylePrompt }),
    // LoRA IDs for LoRA loading (resolved to filenames by worker via config API)
    ...(params.loras && params.loras.length > 0 && { loras: params.loras }),
    ...(params.loraStrengths &&
      params.loraStrengths.length > 0 && { loraStrengths: params.loraStrengths }),
    ...(worldGenerationReceipt && {
      worldGenerationReceipt
    })
  };
  if (
    isAudioParams(params) ||
    (isVideoParams(params) &&
      (isExternalApiVideoModel(params.modelId) || isMinimaxH3Model(params.modelId)))
  ) {
    delete keyFrame.negativePrompt;
  }

  switch (params.type) {
    case 'image':
      if (options.type !== 'image') {
        throw new ApiError(400, {
          status: 'error',
          errorCode: 0,
          message:
            'Invalid model type. Model does not support image generation. Please use a different model.'
        });
      }
      keyFrame = applyImageParams(keyFrame, params, options);
      break;
    case 'video':
      if (options.type !== 'video') {
        throw new ApiError(400, {
          status: 'error',
          errorCode: 0,
          message:
            'Invalid model type. Model does not support video generation. Please use a different model.'
        });
      }
      keyFrame = applyVideoParams(keyFrame, params, options);
      break;
    case 'audio':
      if (options.type !== 'audio') {
        throw new ApiError(400, {
          status: 'error',
          errorCode: 0,
          message:
            'Invalid model type. Model does not support audio generation. Please use a different model.'
        });
      }
      keyFrame = applyAudioParams(keyFrame, params, options);
      break;
    default:
      throw new ApiError(400, {
        status: 'error',
        errorCode: 0,
        message: 'Invalid project type. Must be "image", "video", or "audio".'
      });
  }

  const jobRequest: Record<string, any> = {
    ...template,
    keyFrames: [keyFrame],
    // No utility workflow has intermediate images to preview: segmentation
    // returns one mask and Pixal3D a 3D reconstruction.
    previews:
      isSegmentationModel(params.modelId) || params.modelId === PIXAL3D_WORKFLOW_ID
        ? 0
        : isImageParams(params)
          ? params.numberOfPreviews || 0
          : 0,
    // Segmentation is deterministic: it takes no seed, so N copies of one
    // source are N identical masks at N times the price.
    numberOfImages: isSegmentationModel(params.modelId) ? 1 : params.numberOfMedia || 1,
    jobID: id,
    disableSafety: !!params.disableNSFWFilter,
    tokenType: params.tokenType,
    billingMode: params.billingMode,
    outputFormat:
      params.modelId === PIXAL3D_WORKFLOW_ID
        ? 'glb'
        : isSegmentationModel(params.modelId)
          ? 'png'
          : params.outputFormat ||
            (isAudioParams(params) ? 'mp3' : isVideoParams(params) ? 'mp4' : 'png'),
    ...workloadAttributionToWireFields(params.attribution)
  };

  if (params.network) {
    jobRequest.network = params.network;
  }
  if (params.appSource) {
    jobRequest.appSource = params.appSource;
  }

  return jobRequest;
}

export type JobRequestRaw = ReturnType<typeof createJobRequestMessage>;

export default createJobRequestMessage;
