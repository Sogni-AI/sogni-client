import ApiGroup from '../ApiGroup.js';
import { ApiResponse } from '../ApiClient/index.js';
import { LeaderboardItem, LeaderboardParams } from './types.js';

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
