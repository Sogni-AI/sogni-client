import { AudioTier, ComfyImageTier, ImageTier, NumericDefaults, VideoTier } from './ModelTiersRaw';
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

export interface AudioModelOptions {
  type: 'audio';
  steps: NumRange;
  guidance: NumRange;
  sampler: Options<string>;
  scheduler: Options<string>;
  duration: NumRange;
  bpm: NumRange;
  timesignature: Options<string>;
  language: Options<string>;
  keyscale?: Options<string>;
  composerMode?: { default: boolean };
  promptStrength?: NumRange;
  creativity?: NumRange;
}

export type ModelOptions = ImageModelOptions | VideoModelOptions | AudioModelOptions;

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

export function mapAudioTier(tier: AudioTier): AudioModelOptions {
  const options: AudioModelOptions = {
    type: 'audio',
    steps: mapRange(tier.steps),
    guidance: mapRange(tier.guidance),
    sampler: mapOptions(tier.comfySampler, samplerValueToAlias),
    scheduler: mapOptions(tier.comfyScheduler, schedulerValueToAlias),
    duration: mapRange(tier.duration),
    bpm: mapRange(tier.bpm),
    timesignature: mapOptions(tier.timesignature),
    language: mapOptions(tier.language)
  };
  if (tier.keyscale) {
    options.keyscale = mapOptions(tier.keyscale);
  }
  if (tier.composerMode) {
    options.composerMode = { default: tier.composerMode.default };
  }
  if (tier.promptStrength) {
    options.promptStrength = mapRange(tier.promptStrength);
  }
  if (tier.creativity) {
    options.creativity = mapRange(tier.creativity);
  }
  return options;
}
