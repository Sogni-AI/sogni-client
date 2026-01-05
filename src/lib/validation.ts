import { isRawSampler, isSampler, SupportedSamplers } from '../Projects/types/SamplerParams';
import { isScheduler, SupportedSchedulers } from '../Projects/types/SchedulerParams';

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

export function validateSampler(value?: string) {
  if (!value) {
    return null;
  }
  if (isRawSampler(value)) {
    return value;
  }
  if (isSampler(value)) {
    return SupportedSamplers[value];
  }
  throw new Error(
    `Invalid sampler: ${value}. Supported options: ${Object.keys(SupportedSamplers).join(', ')}`
  );
}

export function validateScheduler(value?: string) {
  if (!value) {
    return null;
  }
  if (isRawSampler(value)) {
    return value;
  }
  if (isScheduler(value)) {
    return SupportedSchedulers[value];
  }
  throw new Error(
    `Invalid scheduler: ${value}. Supported options: ${Object.keys(SupportedSchedulers).join(', ')}`
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
