import { ComfyImageTier, ImageTier, NumericDefaults, VideoTier } from './ModelTiersRaw';
import { samplerValueToAlias } from '../utils/samplers';
import { schedulerValueToAlias } from '../utils/scheduler';

interface NumRange {
  min: number;
  max: number;
  step: number;
  default: number;
}

interface Options<T> {
  allowed: T[];
  default: T | null;
}

interface NumOptions {
  options: number[];
  default: number;
}

export interface ImageModelOptions {
  type: 'image';
  steps: NumRange;
  guidance: NumRange;
  scheduler: Options<string>;
  sampler: Options<string>;
}

export interface VideoModelOptions {
  type: 'video';
  steps: NumRange;
  guidance: NumRange;
  fps: Options<number>;
  sampler: Options<string>;
  scheduler: Options<string>;
}

export type ModelOptions = ImageModelOptions | VideoModelOptions;

function mapRange(data: NumericDefaults): NumRange {
  return {
    min: data.min,
    max: data.max,
    step: data.decimals ? Math.pow(10, 0 - data.decimals) : data.step || 1,
    default: data.default
  };
}

function mapOptions<T>(data: Options<T> | undefined, mapper = (value: T) => value): Options<T> {
  if (!data) {
    return {
      allowed: [],
      default: null
    };
  }
  return {
    allowed: data.allowed.map(mapper),
    default: data.default !== null ? mapper(data.default) : null
  };
}

export function mapImageTier(tier: ImageTier): ImageModelOptions {
  return {
    type: 'image',
    steps: mapRange(tier.steps),
    guidance: mapRange(tier.guidance),
    scheduler: mapOptions(tier.scheduler, schedulerValueToAlias),
    sampler: mapOptions(tier.sampler, samplerValueToAlias)
  };
}

export function mapComfyImageTier(tier: ComfyImageTier): ImageModelOptions {
  return {
    type: 'image',
    steps: mapRange(tier.steps),
    guidance: mapRange(tier.guidance),
    scheduler: mapOptions(tier.comfyScheduler, schedulerValueToAlias),
    sampler: mapOptions(tier.comfySampler, samplerValueToAlias)
  };
}

export function mapVideoTier(tier: VideoTier): VideoModelOptions {
  return {
    type: 'video',
    steps: mapRange(tier.steps),
    guidance: mapRange(tier.guidance),
    scheduler: mapOptions(tier.comfyScheduler, schedulerValueToAlias),
    sampler: mapOptions(tier.comfySampler, samplerValueToAlias),
    fps: tier.fps
  };
}
