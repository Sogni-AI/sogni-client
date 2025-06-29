import ApiGroup from '../ApiGroup';
import { ApiResponse } from '../ApiClient';
import { LeaderboardItem, LeaderboardParams } from './types';

class StatsApi extends ApiGroup {
  async leaderboard(params: LeaderboardParams) {
    const res = await this.client.rest.get<ApiResponse<LeaderboardItem[]>>(
      '/v1/leaderboard/',
      params
    );
    return res.data;
  }
}

export default StatsApi;
