import { JobRequestRaw } from '../../Projects/createJobRequestMessage';
import { SupernetType } from './types';

export interface SocketMessageMap {
  jobRequest: JobRequestRaw;
  changeNetwork: SupernetType;
}

export type MessageType = keyof SocketMessageMap;
