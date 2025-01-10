import { SupernetType } from '../../ApiClient/WebSocketClient/types';

export interface RawProject {
  id: string;
  SID: number;
  artist: Account;
  model: ProjectModel;
  imageCount: number;
  stepCount: number;
  previewCount: number;
  hasGuideImage: boolean;
  denoiseStrength: string;
  costEstimate: CostEstimate;
  costActual: CostActual;
  createTime: number;
  updateTime: number;
  endTime: number;
  status: RawProjectStatus;
  reason: 'allJobsCompleted' | 'artistCanceled';
  network: SupernetType;
  txId: string;
  workerJobs: RawJob[];
  completedWorkerJobs: RawJob[];
}

type RawProjectStatus =
  | 'pending'
  | 'active'
  | 'assigned'
  | 'progress'
  | 'errored'
  | 'completed'
  | 'cancelled';

export interface Account {
  id?: string;
  clientSID?: number;
  address?: string;
  addressSID?: number;
  name?: string;
  username?: string;
}

export interface RawJob {
  id: string;
  SID: string;
  imgID?: string;
  worker: Account;
  createTime: number;
  startTime: number | null;
  updateTime: number;
  endTime: number;
  status: WorkerJobStatus;
  reason: WorkerJobReason;
  performedSteps: number;
  triggeredNSFWFilter: boolean;
  seedUsed: number;
  costActual: CostActual;
  network: SupernetType;
  txId?: string;
}

export interface CostActual {
  costInRenderSec: string;
  costInUSD: string;
  costInToken: string;
  calculatedStepCount?: number;
}

export type WorkerJobReason =
  | 'artistCanceled'
  | 'artistDisconnected'
  | 'genfailure'
  | 'imgUploadFailure'
  | 'jobCompleted'
  | 'jobTimedOut'
  | 'workerDisconnected'
  | 'workerReconnected';

export type WorkerJobStatus =
  | 'created'
  | 'queued'
  | 'assigned'
  | 'initiatingModel'
  | 'jobStarted'
  | 'jobProgress'
  | 'jobCompleted'
  | 'jobError';

export interface CostEstimate {
  rate: Rate;
  quote: Quote;
}

export interface Quote {
  model: QuoteModel;
  job: CostActual;
  project: CostActual;
}

export interface QuoteModel {
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
  network: SupernetType;
  networkCostMultiplier: string;
}

export interface ProjectModel {
  id: string;
  SID: number;
  name: string;
}
