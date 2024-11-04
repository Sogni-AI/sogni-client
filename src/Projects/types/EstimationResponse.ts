export interface EstimationResponse {
  request: Request;
  rate: Rate;
  quote: Quote;
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
