import { SupernetType } from './types';

export type BalanceData = {
  settled: string;
  credit: string;
  debit: string;
  net: string;
};

export type JobErrorData = {
  jobID: string;
  imgID?: string;
  isFromWorker: boolean;
  error_message: string;
  error: number | string;
};

export type JobProgressData = {
  jobID: string;
  imgID: string;
  hasImage: boolean;
  step: number;
  stepCount: number;
};

export type JobResultData = {
  jobID: string;
  imgID: string;
  performedStepCount: number;
  lastSeed: string;
  userCanceled: boolean;
  triggeredNSFWFilter: boolean;
};

export type JobStateData =
  | {
      type: 'initiatingModel' | 'jobStarted';
      jobID: string;
      imgID: string;
      workerName: string;
    }
  | {
      jobID: string;
      type: 'queued';
      queuePosition: number;
    }
  | {
      type: 'jobCompleted';
      jobID: string;
    };

export type ServerConnectData = {
  network: SupernetType;
};

export type ServerDisconnectData = {
  code: number;
  reason: string;
};

export type SocketEventMap = {
  /**
   * @event WebSocketClient#balanceUpdate - Received balance update
   */
  balanceUpdate: BalanceData;
  /**
   * @event WebSocketClient#changeNetwork - Default network changed
   */
  changeNetwork: { network: SupernetType };
  /**
   * @event WebSocketClient#jobError - Job error occurred
   */
  jobError: JobErrorData;
  /**
   * @event WebSocketClient#jobProgress - Job progress update
   */
  jobProgress: JobProgressData;
  /**
   * @event WebSocketClient#jobResult - Job result received
   */
  jobResult: JobResultData;
  /**
   * @event WebSocketClient#jobState - Job state changed
   */
  jobState: JobStateData;
  /**
   * @event WebSocketClient#swarmModels - Received swarm model count
   */
  swarmModels: Record<string, number>;
  /**
   * @event WebSocketClient#connected - WebSocket connection opened
   */
  connected: ServerConnectData;
  /**
   * @event WebSocketClient#disconnected - WebSocket connection was closed
   */
  disconnected: ServerDisconnectData;
};
