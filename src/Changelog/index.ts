import ApiGroup from '../ApiGroup.js';
import { ApiError, ApiResponse } from '../ApiClient/index.js';
import type {
  ChangelogEntry,
  ChangelogProduct,
  ListChangelogOptions,
  ListChangelogResult
} from './types.js';

function joined(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value.join(',') : value;
}

/**
 * The public Sogni changelog (`/v1/changelog`): what changed on Sogni for
 * artists, developers and worker operators.
 *
 * These reads need no sign-in, so they work on a client that is not
 * authenticated. Responses may be up to five minutes old; poll no more often
 * than that. A refused request throws `ApiError` with the API's status and
 * message.
 *
 * Full contract: https://docs.sogni.ai/api-reference/changelog/
 */
class ChangelogApi extends ApiGroup {
  /**
   * One page of published entries, newest first. Pass the returned
   * `nextCursor` as `cursor`, with the same filters, for the next page.
   */
  async list(options: ListChangelogOptions = {}): Promise<ListChangelogResult> {
    const res = await this.client.rest.get<ApiResponse<ListChangelogResult>>('/v1/changelog', {
      audience: joined(options.audience),
      product: joined(options.product),
      type: joined(options.type),
      since: options.since,
      until: options.until,
      actionRequired: options.actionRequired ? 'true' : undefined,
      limit: options.limit,
      cursor: options.cursor
    });
    return res.data;
  }

  /**
   * One published entry by its id. An id with no published entry throws
   * `ApiError` with status `404` and `payload.errorCode` `204`.
   */
  async get(id: string): Promise<ChangelogEntry> {
    const res = await this.client.rest.get<ApiResponse<{ entry?: ChangelogEntry }>>(
      `/v1/changelog/${encodeURIComponent(id)}`
    );
    const entry = res.data?.entry;
    if (!entry) {
      // An empty id requests the list itself, and `products` or `feed.json` the
      // product list or the feed; none of them is an entry.
      throw new ApiError(404, {
        status: 'error',
        message: 'Changelog entry not found',
        errorCode: 204
      });
    }
    return entry;
  }

  /** The products entries can name, in display order. */
  async products(): Promise<ChangelogProduct[]> {
    const res =
      await this.client.rest.get<ApiResponse<{ products: ChangelogProduct[] }>>(
        '/v1/changelog/products'
      );
    return res.data.products;
  }
}

export default ChangelogApi;
