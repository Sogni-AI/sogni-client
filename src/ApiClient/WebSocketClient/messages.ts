import { JobRequestRaw } from '../../Projects/createJobRequestMessage';

export interface SocketMessageMap {
  jobRequest: JobRequestRaw;
}

export type MessageType = keyof SocketMessageMap;
