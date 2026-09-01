export interface EstimationResponse {
  request: Request;
  rate: Rate;
  quote: Quote;
  /** Present only when the server has enough live samples for this exact model/settings combination. */
  benchmark?: Benchmark;
}

export interface Benchmark {
  estimatedRenderTimeSec: number;
  medianRenderTimeSec: number;
  sampleCount: number;
  confidence: number;
  /** Average current queue wait, when a wait benchmark exists for this model/network. */
  estimatedWaitTimeSec?: number;
  /** estimatedRenderTimeSec + estimatedWaitTimeSec, when both exist. */
  estimatedTotalTimeSec?: number;
}

export interface Quote {
  model: Model;
  job: Job;
  project: Job;
}

export interface Job {
  costInRenderSec: string;
  costInUSD: string;
  costInToken: string;
  costInSpark: string;
  costInSogni: string;
  calculatedStepCount?: number;
}

export interface Model {
  weight: string;
  secPerStep: string;
  secPerPreview: string;
  secForCN: string;
}

export interface Rate {
  costPerBaseHQRenderInUSD: string;
  tokenMarkePriceUSD: string;
  costPerRenderSecUSD: string;
  costPerRenderSecToken: string;
  network: string;
  networkCostMultiplier: string;
}

export interface Request {
  model: string;
  name: string;
  imageCount: number;
  stepCount: number;
  previewCount: number;
  cnEnabled: boolean;
  denoiseStrength: string;
  time: Date;
}
