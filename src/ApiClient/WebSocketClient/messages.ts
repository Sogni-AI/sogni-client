import { JobRequestRaw } from '../../Projects/createJobRequestMessage';
import { SupernetType } from './types';
import { ChatRequestMessage } from '../../Chat/types';

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
}

export type MessageType = keyof SocketMessageMap;
