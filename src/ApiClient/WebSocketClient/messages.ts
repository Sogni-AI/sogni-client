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

export interface SocketMessageMap {
  jobRequest: JobRequestRaw;
  jobError: JobErrorMessage;
  changeNetwork: SupernetType;
  llmJobRequest: ChatRequestMessage;
  setSocketEventSubscriptions: SocketEventSubscriptionUpdate;
  /** Media capability declaration on an open connection. */
  mediaCapability: { sogniMedia: 'ciphertext-v1' };
  /** Owner opt-in: run one waiting plan project on Premium Spark now. */
  switchProjectToPremiumSpark: { projectId: string };
}

export type MessageType = keyof SocketMessageMap;
