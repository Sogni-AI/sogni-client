import { JobRequestRaw } from '../../Projects/createJobRequestMessage.js';
import { SupernetType } from './types.js';
import { ChatRequestMessage } from '../../Chat/types.js';
import type { SocketEventSubscriptionUpdate } from './eventSubscriptions.js';

export interface JobErrorMessage {
  jobID: string;
  error: 'artistCanceled';
  error_message: 'artistCanceled';
  isFromWorker: false;
}

export interface LLMJobCancelMessage {
  jobID: string;
}

export interface SocketMessageMap {
  jobRequest: JobRequestRaw;
  jobError: JobErrorMessage;
  changeNetwork: SupernetType;
  llmJobRequest: ChatRequestMessage;
  llmJobCancel: LLMJobCancelMessage;
  setSocketEventSubscriptions: SocketEventSubscriptionUpdate;
}

export type MessageType = keyof SocketMessageMap;
