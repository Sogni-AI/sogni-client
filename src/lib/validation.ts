import { resolveGptImageGifSize } from './gptImageGif.js';
export { resolveGptImageGifSize } from './gptImageGif.js';
import { ApiError } from '../ApiClient/index.js';
import { ModelOptions } from '../Projects/types/ModelOptions.js';
import type { ImageProjectParams } from '../Projects/types/index.js';

const GPT_IMAGE_MODEL_IDS = new Set([
  'gpt-image-2',
  'gpt-image-2.5-sunburst',
  'gpt-image-2.5-flare',
  'gpt-image-2.6-sunburst',
  'gpt-image-2.6-flare'
]);

export function isGptImageModel(modelId?: string): boolean {
  return modelId !== undefined && GPT_IMAGE_MODEL_IDS.has(modelId);
}

export function validateGptImageOptions(params: ImageProjectParams): void {
  const is26 =
    params.modelId === 'gpt-image-2.6-sunburst' || params.modelId === 'gpt-image-2.6-flare';
  const advancedFormat = params.outputFormat === 'gif';
  if (
    !is26 &&
    (advancedFormat ||
      params.gptImageComplexity !== undefined ||
      params.gptImageFrameCount !== undefined ||
      params.gptImageFrameDurationMs !== undefined ||
      params.gptImageMarkupUrl !== undefined)
  ) {
    throw new Error('GIF, complexity and markup options require GPT Image 2.6');
  }
  if (is26) {
    if (
      params.outputFormat === 'gif' &&
      (!params.sizePreset || params.sizePreset === 'custom' || params.width || params.height)
    )
      resolveGptImageGifSize(params.width, params.height, params.gptImageFrameCount);
    if (
      params.gptImageComplexity !== undefined &&
      !['low', 'medium', 'high'].includes(params.gptImageComplexity)
    )
      throw new Error('Unsupported GPT Image complexity');
    if (
      advancedFormat &&
      (params.gptImageMask || params.gptImageMaskUrl || params.gptImageMarkupUrl)
    )
      throw new Error('GIF output cannot combine with masks or markup');
    if (
      params.outputFormat !== 'gif' &&
      (params.gptImageFrameCount !== undefined || params.gptImageFrameDurationMs !== undefined)
    )
      throw new Error('Frame options require GIF output');
    if (
      params.gptImageFrameCount !== undefined &&
      (!Number.isInteger(params.gptImageFrameCount) ||
        params.gptImageFrameCount < 2 ||
        params.gptImageFrameCount > 16)
    )
      throw new Error('GIF frame count must be an integer from 2 to 16');
    if (
      params.gptImageFrameDurationMs !== undefined &&
      (!Number.isInteger(params.gptImageFrameDurationMs) ||
        params.gptImageFrameDurationMs < 20 ||
        params.gptImageFrameDurationMs > 2000)
    )
      throw new Error('GIF frame duration must be an integer from 20 to 2000 ms');
    if (
      params.gptImageMarkupUrl !== undefined &&
      (!params.gptImageMarkupUrl.trim() ||
        !params.contextImages?.length ||
        params.gptImageMask ||
        params.gptImageMaskUrl)
    )
      throw new Error('Markup requires a first edit reference and cannot combine with a mask');
    if (params.gptImageBackground === 'transparent' && advancedFormat)
      throw new Error('Transparent output requires PNG or WebP');
  }
  if (!isGptImageModel(params.modelId)) {
    if (params.gptImageMask || params.gptImageMaskUrl)
      throw new Error('GPT Image masks require a GPT Image model');
    return;
  }
  if (params.gptImageMask && params.gptImageMaskUrl) throw new Error('Provide one GPT Image mask');
  if (params.gptImageMask && !params.contextImages?.length)
    throw new Error('GPT Image mask requires a first reference image');
  if (
    params.contextImages !== undefined &&
    (!Array.isArray(params.contextImages) ||
      params.contextImages.length > 16 ||
      params.contextImages.some((image) => !image))
  ) {
    throw new Error('GPT Image accepts up to 16 non-empty references in source order');
  }
  if (
    params.gptImageMaskUrl !== undefined &&
    (typeof params.gptImageMaskUrl !== 'string' ||
      !params.gptImageMaskUrl.trim() ||
      !params.contextImages?.length)
  ) {
    throw new Error('GPT Image mask requires a mask URL and a first reference image');
  }
  const is25 = params.modelId !== 'gpt-image-2';
  const quality = params.gptImageQuality;
  if (quality === 'auto') {
    throw new Error(
      `Unsupported quality for ${params.modelId}: auto. Choose low, medium or high${is25 ? ', xhigh or max' : ''}.`
    );
  }
  if (quality !== undefined) {
    const allowed = ['low', 'medium', 'high', 'standard', 'hd', ...(is25 ? ['xhigh', 'max'] : [])];
    if (!allowed.includes(quality))
      throw new Error(`Unsupported quality for ${params.modelId}: ${quality}`);
  }
  const background = params.gptImageBackground;
  if (
    background !== undefined &&
    !['opaque', 'auto', ...(is25 ? ['transparent'] : [])].includes(background)
  ) {
    throw new Error(`Unsupported background for ${params.modelId}: ${background}`);
  }
  if (background === 'transparent' && params.outputFormat === 'jpg') {
    throw new Error('Transparent GPT Image output requires PNG or WebP');
  }
  const compression = params.gptImageOutputCompression;
  if (compression !== undefined) {
    if (!Number.isInteger(compression) || compression < 0 || compression > 100) {
      throw new Error('GPT Image output compression must be an integer from 0 to 100');
    }
    if (params.outputFormat !== 'jpg' && params.outputFormat !== 'webp') {
      throw new Error('GPT Image output compression requires JPEG or WebP');
    }
  }
}

/**
 * Seedream 5.0 Pro Uncensored: ByteDance's Seedream 5.0 Pro, an external
 * API-backed image model for text-to-image and for edits from 1-10 reference
 * images (`contextImages`). Spark-only, with no negative prompt, seed or steps.
 * Each account must accept the one-time likeness and consent agreement that
 * Seedance 2.5 Uncensored uses (key `seedance-2-5-uncensored`) in a Sogni app
 * first; until then its jobs fail with error code 4103
 * (`MODEL_CONSENT_REQUIRED_ERROR_CODE`).
 */
export const SEEDREAM_5_PRO_UNCENSORED_MODEL_ID = 'seedream-5-0-pro-uncensored';

/**
 * Seedream 5.5 Uncensored: ByteDance's Seedream 5.5 with the contract of
 * Seedream 5.0 Pro Uncensored (text-to-image, 1-10 reference edits and the
 * same one-time agreement), plus sizes up to 4,624,220 pixels, transparent
 * backgrounds (`seedreamBackground`) and up to 99 decomposition layers with
 * optional text recognition. Chosen only by name.
 */
export const SEEDREAM_5_5_UNCENSORED_MODEL_ID = 'seedream-5-5-uncensored';

const SEEDREAM_MODEL_IDS = new Set([
  SEEDREAM_5_PRO_UNCENSORED_MODEL_ID,
  SEEDREAM_5_5_UNCENSORED_MODEL_ID
]);
const SEEDREAM_MAX_CONTEXT_IMAGES = 10;
// Output limits: 921,600 (1280x720) pixels up to 4,194,304 (2048x2048) on 5.0
// Pro and 4,624,220 (2048x2048x1.1025) on 5.5, at an aspect ratio from 1:16 to
// 16:1. Together they bound each edge to 240-8192 px on 5.0 Pro (3840x240 and
// 8192x512 are the extremes) and 240-8595 px on 5.5 (8595x538).
const SEEDREAM_MIN_PIXELS = 921_600;
const SEEDREAM_MAX_PIXELS = 4_194_304;
const SEEDREAM_5_5_MAX_PIXELS = 4_624_220;
const SEEDREAM_5_5_MAX_EDGE = 8595;
const SEEDREAM_MAX_ASPECT_RATIO = 16;
const SEEDREAM_LAYER_SIZES = ['1K', '1.5K', '2K'];
const SEEDREAM_BACKGROUNDS = ['opaque', 'transparent', 'auto'];
const SEEDREAM_LAYER_MAX_IMAGES_MIN = 2;
const SEEDREAM_LAYER_MAX_IMAGES_MAX = 100;
const SEEDREAM_5_5_ONLY_OPTIONS = [
  'seedreamBackground',
  'seedreamLayerMaxImages',
  'seedreamLayerTextRecognition'
] as const;

/** Whether `modelId` is a Seedream image model (Seedream 5.0 Pro Uncensored or Seedream 5.5 Uncensored). */
export function isSeedreamModel(modelId?: string): boolean {
  return modelId !== undefined && SEEDREAM_MODEL_IDS.has(modelId);
}

/**
 * Check a Seedream request before anything is uploaded: at most 10 non-empty
 * reference images, a custom size inside the model's pixel and aspect-ratio
 * limits, the one-reference rule of layer decomposition, and the Seedream 5.5
 * Uncensored background and layer options.
 */
export function validateSeedreamOptions(params: ImageProjectParams): void {
  if (!isSeedreamModel(params.modelId)) {
    if (
      params.seedreamLayerDecomposition !== undefined ||
      params.seedreamLayerSize !== undefined ||
      params.seedreamLayerMaxImages !== undefined ||
      params.seedreamLayerTextRecognition !== undefined
    )
      throw new Error('Seedream layer options require a Seedream model');
    if (params.seedreamBackground !== undefined)
      throw new Error(`seedreamBackground requires ${SEEDREAM_5_5_UNCENSORED_MODEL_ID}`);
    return;
  }
  const isSeedream55 = params.modelId === SEEDREAM_5_5_UNCENSORED_MODEL_ID;
  if (!isSeedream55) {
    for (const option of SEEDREAM_5_5_ONLY_OPTIONS) {
      if (params[option] !== undefined)
        throw new Error(`${option} requires ${SEEDREAM_5_5_UNCENSORED_MODEL_ID}`);
    }
  }
  if (
    params.contextImages !== undefined &&
    (!Array.isArray(params.contextImages) ||
      params.contextImages.length > SEEDREAM_MAX_CONTEXT_IMAGES ||
      params.contextImages.some((image) => !image))
  ) {
    throw new Error(
      `${params.modelId} accepts up to ${SEEDREAM_MAX_CONTEXT_IMAGES} non-empty reference images in source order`
    );
  }
  const contextImageCount = params.contextImages?.length ?? 0;
  const layerDecomposition = params.seedreamLayerDecomposition;
  if (layerDecomposition !== undefined && typeof layerDecomposition !== 'boolean') {
    throw new Error('seedreamLayerDecomposition must be a boolean');
  }
  if (
    params.seedreamLayerSize !== undefined &&
    !SEEDREAM_LAYER_SIZES.includes(params.seedreamLayerSize)
  ) {
    throw new Error('seedreamLayerSize must be 1K, 1.5K or 2K');
  }
  if (params.seedreamLayerSize !== undefined && !layerDecomposition)
    throw new Error('seedreamLayerSize requires seedreamLayerDecomposition');
  const layerMaxImages = params.seedreamLayerMaxImages;
  if (layerMaxImages !== undefined) {
    if (
      !Number.isInteger(layerMaxImages) ||
      layerMaxImages < SEEDREAM_LAYER_MAX_IMAGES_MIN ||
      layerMaxImages > SEEDREAM_LAYER_MAX_IMAGES_MAX
    )
      throw new Error('seedreamLayerMaxImages must be an integer from 2 to 100');
    if (!layerDecomposition)
      throw new Error('seedreamLayerMaxImages requires seedreamLayerDecomposition');
  }
  const textRecognition = params.seedreamLayerTextRecognition;
  if (textRecognition !== undefined) {
    if (typeof textRecognition !== 'boolean')
      throw new Error('seedreamLayerTextRecognition must be a boolean');
    if (!layerDecomposition)
      throw new Error('seedreamLayerTextRecognition requires seedreamLayerDecomposition');
  }
  if (layerDecomposition === true) {
    if (contextImageCount !== 1) {
      throw new Error('Seedream layer decomposition splits exactly one reference image');
    }
    if ((params.numberOfMedia ?? 1) !== 1) {
      throw new Error('Seedream layer decomposition renders one result: set numberOfMedia to 1');
    }
  }
  const background = params.seedreamBackground;
  if (background !== undefined) {
    if (!SEEDREAM_BACKGROUNDS.includes(background))
      throw new Error('seedreamBackground must be opaque, transparent or auto');
    if (layerDecomposition)
      throw new Error('seedreamBackground cannot combine with seedreamLayerDecomposition');
    if (background !== 'opaque' && params.outputFormat === 'jpg')
      throw new Error('Transparent or auto Seedream background requires PNG or WebP output');
  }
  const isCustomSize =
    (params.sizePreset === undefined || params.sizePreset === 'custom') &&
    !!params.width &&
    !!params.height;
  if (!isCustomSize) return;
  const width = Number(params.width);
  const height = Number(params.height);
  const pixels = width * height;
  const aspectRatio = Math.max(width, height) / Math.min(width, height);
  const maxPixels = isSeedream55 ? SEEDREAM_5_5_MAX_PIXELS : SEEDREAM_MAX_PIXELS;
  const maxPixelsLabel = isSeedream55 ? '4,624,220' : '4,194,304';
  if (
    pixels < SEEDREAM_MIN_PIXELS ||
    pixels > maxPixels ||
    aspectRatio > SEEDREAM_MAX_ASPECT_RATIO
  ) {
    throw new Error(
      `${params.modelId} renders 921,600 to ${maxPixelsLabel} pixels at an aspect ratio from 1:16 to 16:1; got ${width}x${height}`
    );
  }
}

const EXTENDED_IMAGE_SIZE_MODEL_IDS = new Set([
  'z_image_bf16',
  'z_image_turbo_bf16',
  'krea2_turbo_fp8_scaled',
  'qwen_image_edit_2511_fp8',
  'qwen_image_edit_2511_fp8_lightning',
  'qwen_image_2512_fp8',
  'qwen_image_2512_fp8_lightning'
]);

const KREA_IDENTITY_EDIT_MODEL_IDS = new Set([
  'krea2_identity_edit_v1_2',
  'dark_beast_krea2_identity_edit_v1_2'
]);

const QWEN_IMAGE_MODEL_IDS = new Set([
  'qwen_image_2512_fp8',
  'qwen_image_2512_fp8_lightning',
  'qwen_image_edit_2511_fp8',
  'qwen_image_edit_2511_fp8_lightning'
]);

const QWEN_IMAGE_EDIT_MODEL_IDS = new Set([
  'qwen_image_edit_2511_fp8',
  'qwen_image_edit_2511_fp8_lightning'
]);

export function isQwenImageEditModel(modelId: string): boolean {
  return QWEN_IMAGE_EDIT_MODEL_IDS.has(modelId);
}

export function isKreaIdentityEditModel(modelId: string): boolean {
  return KREA_IDENTITY_EDIT_MODEL_IDS.has(modelId);
}

/** FLUX 3 Image Klein renders text-to-image, start-image and edits from 1-10 references. */
const FLUX3_IMAGE_KLEIN_MODEL_ID = 'flux3_image_klein_sd_int8_convrot';

export function isFlux3ImageKleinModel(modelId: string): boolean {
  return modelId === FLUX3_IMAGE_KLEIN_MODEL_ID;
}

const RTX_VSR_MAX_EDGE = 15360;

interface ImageSizeValidationOptions {
  modelId?: string;
  propertyName?: string;
}

function getCustomImageSizeBounds(modelId?: string): { min: number; max: number } {
  if (['moss_image_sft_int8_convrot', 'moss_image_sft_dmd8_int8_convrot'].includes(modelId || '')) {
    return { min: 512, max: 2048 };
  }
  if (modelId === 'rtx_vsr_pro') {
    return { min: 512, max: RTX_VSR_MAX_EDGE };
  }
  if (modelId && KREA_IDENTITY_EDIT_MODEL_IDS.has(modelId)) {
    return { min: 512, max: 2048 };
  }
  if (isGptImageModel(modelId)) {
    return { min: 256, max: 3840 };
  }
  if (modelId === SEEDREAM_5_5_UNCENSORED_MODEL_ID) {
    return { min: 240, max: SEEDREAM_5_5_MAX_EDGE };
  }
  if (isSeedreamModel(modelId)) {
    return { min: 240, max: 8192 };
  }
  if (modelId && isFlux3ImageKleinModel(modelId)) {
    return { min: 256, max: 4096 };
  }
  if (modelId && EXTENDED_IMAGE_SIZE_MODEL_IDS.has(modelId)) {
    return { min: 256, max: 2560 };
  }
  return { min: 256, max: 2048 };
}

export function validateCustomImageSize(
  value: any,
  { modelId, propertyName = 'Width and height' }: ImageSizeValidationOptions = {}
): number {
  const bounds = getCustomImageSizeBounds(modelId);
  return validateNumber(value, {
    min: bounds.min,
    max: bounds.max,
    propertyName
  });
}

/**
 * Validate video dimensions for Wan 2.2 models.
 * Minimum dimension is 480px for both width and height.
 */
export function validateVideoSize(value: any, propertyName: 'width' | 'height'): number {
  return validateNumber(value, { min: 480, propertyName: `Video ${propertyName}` });
}

export function validateVideoDuration(value: any, min = 1, max = 10): number {
  return validateNumber(value, { min, max, propertyName: 'Video duration' });
}

interface NumberValidationOptions {
  min?: number;
  max?: number;
  propertyName?: string;
  defaultValue?: number;
}

export function validateNumber(
  value: any,
  { min, max, propertyName, defaultValue }: NumberValidationOptions = {}
): number {
  const number = Number(value);
  const hasDefaultValue = defaultValue !== undefined;
  if (!propertyName) {
    propertyName = 'Value';
  }
  if (isNaN(number)) {
    if (hasDefaultValue) {
      return defaultValue;
    }
    throw new Error(`${propertyName} must be a number, got ${value}`);
  }
  if (min !== undefined && number < min) {
    if (hasDefaultValue) {
      return defaultValue;
    }
    throw new Error(`${propertyName} must greater or equal ${min}, got ${number}`);
  }
  if (max !== undefined && number > max) {
    if (hasDefaultValue) {
      return defaultValue;
    }
    throw new Error(`${propertyName} must be less or equal ${max}, got ${number}`);
  }
  return number;
}

/**
 * Validate teacacheThreshold for T2V and I2V models.
 * Range: 0.0-1.0. 0.0 = disabled.
 */
export function validateTeacacheThreshold(value?: number): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const num = Number(value);
  if (isNaN(num)) {
    throw new Error(`teacacheThreshold must be a number, got ${value}`);
  }
  if (num < 0.0 || num > 1.0) {
    throw new Error(`teacacheThreshold must be between 0.0 and 1.0 (got ${num})`);
  }
  return num;
}

export function isComfyModel(modelId: string): boolean {
  const COMFY_PREFIXES = [
    'z_image_',
    'dark_beast_z_image_',
    'krea2_',
    'moss_image_',
    'dark_beast_krea2_',
    'qwen_image_',
    'flux3_',
    'rtx_vsr_',
    'flashvsr_',
    'wan_',
    'ace_step',
    'minimax_music3',
    'qwen3_tts_'
  ];
  return COMFY_PREFIXES.some((prefix) => modelId.startsWith(prefix));
}

/**
 * Get the maximum number of context images supported by a model.
 * - GPT Image 2: 16 images
 * - Seedream 5.0 Pro Uncensored: 10 images
 * - FLUX 3 Image Klein: 10 images (optional)
 * - Qwen Image Edit: 3 images
 * - Krea 2 Identity Edit: 2 images
 * - Legacy Flux Kontext matching: 2 images
 * - Default: 3 images
 */
export function getMaxContextImages(modelId: string): number {
  if (['moss_image_sft_int8_convrot', 'moss_image_sft_dmd8_int8_convrot'].includes(modelId || ''))
    return 0;
  if (isGptImageModel(modelId)) {
    return 16;
  }
  if (isSeedreamModel(modelId)) {
    return SEEDREAM_MAX_CONTEXT_IMAGES;
  }
  if (isFlux3ImageKleinModel(modelId)) {
    return 10;
  }
  if (QWEN_IMAGE_MODEL_IDS.has(modelId)) {
    return 3;
  }
  if (isKreaIdentityEditModel(modelId)) {
    return 2;
  }
  if (modelId.includes('kontext')) {
    return 2;
  }
  // Default fallback for other models that might support context images
  return 3;
}

function validateOption<T = unknown>(value: T, options: T[], errorMessage: string): T {
  if (!options.includes(value)) {
    throw new ApiError(400, {
      status: 'error',
      errorCode: 0,
      message: errorMessage
    });
  }
  return value;
}

/**
 * Validate sampler value against allowed options.
 * Returns the validated value unchanged - sogni-socket handles normalization.
 */
export function validateSampler(value: string | undefined, options: ModelOptions) {
  // A model with no sampler at all - a Qwen3-TTS speech model, say - offers no
  // choice to validate, so a value here is dropped rather than rejected.
  const sampler = options.sampler;
  if (!sampler?.allowed.length || !value) {
    return null;
  }
  return validateOption(
    value,
    sampler.allowed,
    `Invalid sampler ${value}. Must be one of "${sampler.allowed.join('", "')}".`
  );
}

/**
 * Validate scheduler value against allowed options.
 * Returns the validated value unchanged - sogni-socket handles normalization.
 */
export function validateScheduler(value: string | undefined, options: ModelOptions) {
  const scheduler = options.scheduler;
  if (!scheduler?.allowed.length || !value) {
    return null;
  }
  return validateOption(
    value,
    scheduler.allowed,
    `Invalid scheduler ${value}. Must be one of "${scheduler.allowed.join('", "')}".`
  );
}

/**
 * Validate a model-specific VAE value against allowed options.
 * Returns the validated value unchanged; sogni-socket passes the filename to ComfyUI.
 */
export function validateVae(value: string | undefined, options: ModelOptions) {
  if (!('vae' in options) || !options.vae?.allowed.length || !value) {
    return null;
  }
  return validateOption(
    value,
    options.vae.allowed,
    `Invalid VAE ${value}. Must be one of "${options.vae.allowed.join('", "')}".`
  );
}
