import {
  isRawForgeSampler,
  isForgeSampler,
  SupportedForgeSamplers
} from '../Projects/types/ForgeSamplerParams';
import {
  isForgeScheduler,
  isRawForgeScheduler,
  SupportedForgeSchedulers
} from '../Projects/types/ForgeSchedulerParams';
import { isComfySampler, SupportedComfySamplers } from '../Projects/types/ComfySamplerParams';
import { isComfyScheduler, SupportedComfySchedulers } from '../Projects/types/ComfySchedulerParams';

export function validateCustomImageSize(value: any): number {
  return validateNumber(value, { min: 256, max: 2048, propertyName: 'Width and height' });
}

/**
 * Validate video dimensions for Wan 2.2 models.
 * Minimum dimension is 480px for both width and height.
 */
export function validateVideoSize(value: any, propertyName: 'width' | 'height'): number {
  return validateNumber(value, { min: 480, propertyName: `Video ${propertyName}` });
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
  if (propertyName) {
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

export function validateForgeSampler(value?: string) {
  if (!value) {
    return null;
  }
  if (isRawForgeSampler(value)) {
    return value;
  }
  if (isForgeSampler(value)) {
    return SupportedForgeSamplers[value];
  }
  throw new Error(
    `Invalid sampler: ${value}. Supported options: ${Object.keys(SupportedForgeSamplers).join(', ')}`
  );
}

export function validateForgeScheduler(value?: string) {
  if (!value) {
    return null;
  }
  if (isRawForgeScheduler(value)) {
    return value;
  }
  if (isForgeScheduler(value)) {
    return SupportedForgeSchedulers[value];
  }
  throw new Error(
    `Invalid scheduler: ${value}. Supported options: ${Object.keys(SupportedForgeSchedulers).join(', ')}`
  );
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

/**
 * Validate ComfyUI sampler for video models.
 * Returns the sampler string directly (no mapping needed).
 */
export function validateComfySampler(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }
  if (isComfySampler(value)) {
    return SupportedComfySamplers[value];
  }
  throw new Error(
    `Invalid comfySampler: ${value}. Supported options: ${Object.keys(SupportedComfySamplers).join(', ')}`
  );
}

/**
 * Validate ComfyUI scheduler for video models.
 * Returns the scheduler string directly (no mapping needed).
 */
export function validateComfyScheduler(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }
  if (isComfyScheduler(value)) {
    return SupportedComfySchedulers[value];
  }
  throw new Error(
    `Invalid comfyScheduler: ${value}. Supported options: ${Object.keys(SupportedComfySchedulers).join(', ')}`
  );
}

export function isComfyModel(modelId: string): boolean {
  const COMFY_PREFIXES = ['z_image_', 'qwen_image_', 'flux2_', 'wan_'];
  return COMFY_PREFIXES.some((prefix) => modelId.startsWith(prefix));
}

export function validateSampler(modelId: string, sampler: string) {
  if (isComfyModel(modelId)) {
    return validateComfySampler(sampler);
  }
  return validateForgeSampler(sampler);
}

export function validateScheduler(modelId: string, scheduler: string) {
  if (isComfyModel(modelId)) {
    return validateComfyScheduler(scheduler);
  }
  return validateForgeScheduler(scheduler);
}
