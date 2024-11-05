import ApiGroup from '../ApiGroup';
import { ApiReponse } from '../ApiClient/ApiClient';
import { LeaderboardItem, LeaderboardParams } from './types';

class StatsApi extends ApiGroup {
  async leaderboard(params: LeaderboardParams) {
    const res = await this.client.rest.get<ApiReponse<LeaderboardItem[]>>(
      '/v1/leaderboard/',
      params
    );
    return res.data;
  }
}

export default StatsApi;
