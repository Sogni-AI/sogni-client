/**
 * Replay record types — mirrors the api `/v1/replay/records` shape.
 *
 * `RunRecord` is the full Phase-4 RunRecord schema. Producers serialize
 * one per chat turn; consumers (the replay viewer, harness fixtures)
 * read them back. The SDK keeps a structural type with the well-known
 * envelope fields typed and the rest as `unknown` so callers that hold
 * the richer canonical type (e.g. `@sogni/creative-agent/replay`) can
 * cast safely without the SDK needing that dependency.
 */

/**
 * RunRecord shape, kept minimal so callers that hold the richer
 * canonical type (e.g. `RunRecord` from `@sogni/creative-agent`) pass
 * directly without casting. No index signature — adding one would
 * force callers to widen typed properties to `unknown` to match.
 */
export interface RunRecord {
  run_id: string;
  schema_version?: number | string;
  session_id?: string;
  account_id?: string;
  model_id?: string;
  rounds?: ReadonlyArray<unknown>;
  user_request?: string;
  final_response?: unknown;
}

export interface ReplayWriteResult {
  runId: string;
  schemaVersion: number | string;
  redacted: boolean;
  createTime: number;
  updateTime: number;
}

export interface ReplayRecordSummary {
  runId: string;
  schemaVersion: number | string;
  createTime: number;
  updateTime: number;
  userRequest?: string;
  finalResponse?: unknown;
  modelId?: string;
  rounds: number;
}

export interface ListReplayRecordsOptions {
  limit?: number;
  signal?: AbortSignal;
}

export interface ListReplayRecordsResult {
  records: ReplayRecordSummary[];
}

export interface GetReplayRecordResult {
  record: RunRecord;
  createTime: number;
}

export interface ReplayRequestOptions {
  signal?: AbortSignal;
}
