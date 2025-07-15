export type LeaderboardType =
  | 'renderUSDCompleteWorker'
  | 'renderUSDCompleteArtist'
  | 'renderSecCompleteWorker'
  | 'renderSecCompleteArtist'
  | 'renderTokenCompleteWorker'
  | 'renderTokenCompleteWorker2'
  | 'renderTokenCompleteArtist'
  | 'renderTokenCompleteArtist2'
  | 'jobCompleteWorker'
  | 'jobCompleteArtist'
  | 'projectCompleteArtist'
  | 'uloginWorker'
  | 'uloginArtist'
  | 'tokenVolume'
  | 'referral';

export interface LeaderboardParams {
  type: LeaderboardType;
  period: 'day' | 'lifetime';
  username?: string;
  network?: 'fast' | 'relaxed' | 'all';
  page?: number;
  limit?: number;
  date?: number;
  address?: string;
}

export interface LeaderboardItem {
  rank: number;
  username: string;
  address: string;
  country: string;
  value: string;
  role: string;
}
