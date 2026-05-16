/**
 * Replay records (`/v1/replay/records`).
 *
 * Phase-4 RunRecord ingestion + read. Producers (chat sessions, harness
 * runs) `write(record)` one RunRecord per turn; consumers (the replay
 * viewer, audit tooling) `list()` and `get(runId)` to inspect them.
 *
 * Auth: piggybacks on the SDK's active AuthManager (JWT for signed-in
 * accounts, api-key for programmatic callers). The api enforces
 * per-owner isolation via the resolved wallet address — callers can
 * only see their own records.
 *
 * Errors are mapped to `ApiError` with the api's `errorCode`/`message`
 * when present; HTTP 4xx on read becomes a thrown error so the caller
 * can branch on status without parsing strings.
 */

import ApiGroup, { ApiConfig } from '../ApiGroup';
import { ApiError } from '../ApiClient';
import {
  GetReplayRecordResult,
  ListReplayRecordsOptions,
  ListReplayRecordsResult,
  ReplayRecordSummary,
  ReplayRequestOptions,
  ReplayWriteResult,
  RunRecord
} from './types';

interface ReplayEnvelope {
  // POST response (the ingest endpoint returns the fields flat).
  runId?: string;
  schemaVersion?: number | string;
  redacted?: boolean;
  createTime?: number;
  updateTime?: number;
  // GET list response.
  records?: ReplayRecordSummary[];
  // GET :id response.
  record?: RunRecord;
  status?: string;
  message?: string;
  errorCode?: number;
  [key: string]: unknown;
}

function parseJsonResponse(text: string): ReplayEnvelope {
  if (!text) return {};
  try {
    return JSON.parse(text) as ReplayEnvelope;
  } catch {
    return { status: 'error', message: text, errorCode: 0 };
  }
}

class ReplayApi extends ApiGroup {
  constructor(config: ApiConfig) {
    super(config);
  }

  /**
   * POST /v1/replay/records — ingest one RunRecord. The api re-runs the
   * redaction pass server-side as defense-in-depth, so the returned
   * `redacted` flag reflects what was actually stored.
   */
  async write(
    record: RunRecord,
    options: ReplayRequestOptions = {}
  ): Promise<ReplayWriteResult> {
    const body = await this.request('/v1/replay/records', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record),
      signal: options.signal
    });
    if (typeof body.runId !== 'string') {
      throw new ApiError(500, {
        status: 'error',
        message: 'Replay write response missing runId',
        errorCode: 0
      });
    }
    return {
      runId: body.runId,
      schemaVersion: body.schemaVersion ?? 0,
      redacted: body.redacted === true,
      createTime: typeof body.createTime === 'number' ? body.createTime : 0,
      updateTime: typeof body.updateTime === 'number' ? body.updateTime : 0
    };
  }

  /**
   * GET /v1/replay/records — paginated summary view for the caller's
   * own records. `limit` caps results (api defaults apply when omitted).
   */
  async list(options: ListReplayRecordsOptions = {}): Promise<ListReplayRecordsResult> {
    const query = new URLSearchParams();
    if (typeof options.limit === 'number' && options.limit > 0) {
      query.set('limit', String(Math.floor(options.limit)));
    }
    const path = query.toString()
      ? `/v1/replay/records?${query.toString()}`
      : '/v1/replay/records';
    const body = await this.request(path, {
      method: 'GET',
      signal: options.signal
    });
    const records = Array.isArray(body.records) ? body.records : [];
    return { records };
  }

  /** GET /v1/replay/records/:id — full RunRecord for the viewer detail. */
  async get(
    runId: string,
    options: ReplayRequestOptions = {}
  ): Promise<GetReplayRecordResult> {
    const body = await this.request(
      `/v1/replay/records/${encodeURIComponent(runId)}`,
      { method: 'GET', signal: options.signal }
    );
    if (!body.record || typeof body.record !== 'object') {
      throw new ApiError(500, {
        status: 'error',
        message: 'Replay get response missing record field',
        errorCode: 0
      });
    }
    return {
      record: body.record,
      createTime: typeof body.createTime === 'number' ? body.createTime : 0
    };
  }

  private async request(
    path: string,
    options: RequestInit = {}
  ): Promise<ReplayEnvelope> {
    const response = await this.fetch(path, options);
    if (!response.ok) {
      throw await this.toApiError(response);
    }
    const text = await response.text();
    return parseJsonResponse(text);
  }

  private async fetch(path: string, options: RequestInit = {}): Promise<Response> {
    const url = new URL(path, this.client.rest.baseUrl).toString();
    const authenticated = await this.client.auth.authenticateRequest(options);
    return fetch(url, authenticated);
  }

  private async toApiError(response: Response): Promise<ApiError> {
    if (response.status === 401 && this.client.auth.isAuthenticated) {
      this.client.auth.clear();
    }
    const body = parseJsonResponse(await response.text());
    const payload =
      body.status === 'error' ? body : (body as Record<string, unknown>);
    const message = typeof payload.message === 'string' ? payload.message : response.statusText;
    const errorCode = typeof payload.errorCode === 'number' ? payload.errorCode : 0;
    return new ApiError(response.status, { status: 'error', message, errorCode });
  }
}

export default ReplayApi;
export * from './types';
