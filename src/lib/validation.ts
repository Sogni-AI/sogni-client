import { ApiError } from '../ApiClient';
import { ModelOptions } from '../Projects/types/ModelOptions';
import { schedulerAliasToValue } from '../Projects/utils/scheduler';
import { samplerAliasToValue } from '../Projects/utils/samplers';

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

export function validateVideoDuration(value: any): number {
  return validateNumber(value, { min: 1, max: 10, propertyName: 'Video duration' });
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
  const COMFY_PREFIXES = ['z_image_', 'qwen_image_', 'flux2_', 'wan_'];
  return COMFY_PREFIXES.some((prefix) => modelId.startsWith(prefix));
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

export function validateSampler(value: string | undefined, options: ModelOptions) {
  if (!options.sampler.allowed.length || !value) {
    return null;
  }
  const option = validateOption(
    value,
    options.sampler.allowed,
    `Invalid sampler ${value}. Must be one of "${options.sampler.allowed.join('", "')}".`
  );
  return samplerAliasToValue(option);
}

export function validateScheduler(value: string | undefined, options: ModelOptions) {
  if (!options.scheduler.allowed.length || !value) {
    return null;
  }
  const option = validateOption(
    value,
    options.scheduler.allowed,
    `Invalid scheduler ${value}. Must be one of "${options.scheduler.allowed.join('", "')}".`
  );
  return schedulerAliasToValue(option);
}
