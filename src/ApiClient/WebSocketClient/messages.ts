import { JobRequestRaw } from '../../Projects/createJobRequestMessage';
import { SupernetType } from './types';

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
}

export type MessageType = keyof SocketMessageMap;
