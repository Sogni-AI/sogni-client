import {
  AudioProjectParams,
  ImageProjectParams,
  isAudioParams,
  isImageParams,
  isVideoParams,
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
  calculateVideoFrames,
  isLtx2Model,
  isWanAnimateModel,
  isSeedanceModel,
  isSeedance25Model,
  isHappyhorseModel,
  isMinimaxH3Model,
  isMinimaxH3TurboModel,
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
  MINIMAX_H3_BASE_FRAMES
} from './utils/index.js';
import { ApiError } from '../ApiClient/index.js';
import {
  AudioModelOptions,
  ImageModelOptions,
  ModelOptions,
  VideoModelOptions
} from './types/ModelOptions.js';
import { workloadAttributionToWireFields } from '../lib/attribution.js';

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
  if (isSeedanceModel(params.modelId)) {
    validateSeedanceTaskType(params);
    validateSeedanceReferenceAssets(params);
    return;
  }
  if (isMinimaxH3ReferenceModel(params.modelId)) {
    validateMinimaxH3ReferenceAssets(params);
  } else if (params.referenceImageUrls || params.referenceVideoUrls || params.referenceAudioUrls) {
    throw new ApiError(400, {
      status: 'error',
      errorCode: 0,
      message:
        'referenceImageUrls, referenceVideoUrls, and referenceAudioUrls are supported only by Seedance and HappyHorse models.'
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
  const expectedSteps = isMinimaxH3TurboModel(params.modelId) ? 4 : 20;
  if (params.steps !== undefined && params.steps !== expectedSteps) {
    invalid(
      `MiniMax H3${expectedSteps === 4 ? ' Turbo' : ''} steps are fixed at ${expectedSteps}.`
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

function getMaxVideoDuration(modelId: string): number {
  if (isMinimaxH3Model(modelId)) {
    // 362 frames at a fixed 24fps, the top of the H3 frame grid.
    return MINIMAX_H3_MAX_DURATION;
  }
  if (isSeedance25Model(modelId)) {
    // Seedance 2.5 renders up to 30s in a single call; 2.0/Mini cap at 15s.
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
  if (params.gptImageQuality !== undefined) {
    keyFrame.gptImageQuality = params.gptImageQuality;
  }
  if (params.gptImageBackground !== undefined) {
    keyFrame.gptImageBackground = params.gptImageBackground;
  }
  return keyFrame;
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
  validateMinimaxH3Params(params);
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
  } else if (isExternalApiVideoModel(params.modelId) || isMinimaxH3Model(params.modelId)) {
    keyFrame.fps = 24;
  }
  if (params.frames !== undefined) {
    keyFrame.frames = params.frames;
  }
  if (params.duration !== undefined) {
    // Minimum direct-SDK duration: MiniMax H3 5.167s (124 frames at 24fps,
    // the bottom of its frame grid), HappyHorse 3s, Seedance 4s, others 1s.
    const minDuration = isMinimaxH3Model(params.modelId)
      ? MINIMAX_H3_MIN_DURATION
      : isHappyhorseModel(params.modelId)
        ? 3
        : isSeedanceModel(params.modelId)
          ? 4
          : 1;
    const duration = validateVideoDuration(
      params.duration,
      minDuration,
      getMaxVideoDuration(params.modelId)
    );
    // Use fps from params or default based on model type:
    // - WAN 2.2: fps doesn't affect frame count (always generates at 16fps)
    // - LTX 2.x: fps directly affects frame count (default 24fps if not specified)
    // - Seedance / HappyHorse: fixed 24fps external API generation
    const fps = params.fps ?? 24;
    keyFrame.frames = calculateVideoFrames(params.modelId, duration, fps);
  }
  if (params.shift !== undefined) {
    keyFrame.shift = params.shift;
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

  keyFrame.comfySampler = validateSampler(params.sampler, options);
  keyFrame.comfyScheduler = validateScheduler(params.scheduler, options);

  return keyFrame;
}

function createJobRequestMessage(id: string, params: ProjectParams, options: ModelOptions) {
  const template = getTemplate();
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
      params.loraStrengths.length > 0 && { loraStrengths: params.loraStrengths })
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
    previews: isImageParams(params) ? params.numberOfPreviews || 0 : 0,
    numberOfImages: params.numberOfMedia || 1,
    jobID: id,
    disableSafety: !!params.disableNSFWFilter,
    tokenType: params.tokenType,
    billingMode: params.billingMode,
    outputFormat:
      params.outputFormat ||
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
