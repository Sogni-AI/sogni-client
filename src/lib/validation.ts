import { ApiError } from '../ApiClient/index.js';
import { ModelOptions } from '../Projects/types/ModelOptions.js';
import type { ImageProjectParams } from '../Projects/types/index.js';

const GPT_IMAGE_MODEL_IDS = new Set([
  'gpt-image-2',
  'gpt-image-2.5-sunburst',
  'gpt-image-2.5-flare'
]);

export function isGptImageModel(modelId?: string): boolean {
  return modelId !== undefined && GPT_IMAGE_MODEL_IDS.has(modelId);
}

export function validateGptImageOptions(params: ImageProjectParams): void {
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

const RTX_VSR_MAX_EDGE = 15360;

interface ImageSizeValidationOptions {
  modelId?: string;
  propertyName?: string;
}

function getCustomImageSizeBounds(modelId?: string): { min: number; max: number } {
  if (modelId === 'rtx_vsr_pro') {
    return { min: 512, max: RTX_VSR_MAX_EDGE };
  }
  if (modelId && KREA_IDENTITY_EDIT_MODEL_IDS.has(modelId)) {
    return { min: 512, max: 2048 };
  }
  if (isGptImageModel(modelId)) {
    return { min: 256, max: 3840 };
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
    'dark_beast_krea2_',
    'qwen_image_',
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
 * - Qwen Image Edit: 3 images
 * - Krea 2 Identity Edit: 2 images
 * - Legacy Flux Kontext matching: 2 images
 * - Default: 3 images
 */
export function getMaxContextImages(modelId: string): number {
  if (isGptImageModel(modelId)) {
    return 16;
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
