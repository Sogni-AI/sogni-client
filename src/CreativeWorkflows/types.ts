import { TokenType } from '../types/token';

export type CreativeWorkflowStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'partial_failure'
  | 'waiting_for_user'
  | 'failed'
  | 'cancelled'
  | string;

export type CreativeWorkflowHostedToolName =
  | 'generate_image'
  | 'generate_video'
  | 'generate_music'
  | 'edit_image'
  | 'apply_style'
  | 'restore_photo'
  | 'refine_result'
  | 'animate_photo'
  | 'change_angle'
  | 'video_to_video'
  | 'stitch_video'
  | 'orbit_video'
  | 'dance_montage'
  | 'sound_to_video'
  | 'extend_video'
  | 'replace_video_segment'
  | 'overlay_video'
  | 'add_subtitles'
  | 'analyze_image'
  | 'analyze_video'
  | 'extract_metadata'
  | 'ask_clarifying_question'
  | 'finalize_response'
  | 'create_asset_manifest'
  | 'inspect_asset'
  | 'label_asset'
  | 'map_assets_for_model'
  | 'validate_asset_references';

export interface CreativeWorkflowArtifact {
  id?: string;
  url?: string;
  type?: string;
  mediaType?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  duration?: number;
  [key: string]: unknown;
}

export interface CreativeWorkflowEvent {
  id?: string | number;
  event?: string;
  type?: string;
  status?: CreativeWorkflowStatus;
  message?: string;
  timestamp?: number;
  data?: unknown;
  [key: string]: unknown;
}

export interface CreativeWorkflowRecord {
  workflowId: string;
  title?: string;
  status?: CreativeWorkflowStatus;
  input?: Record<string, unknown>;
  plan?: Record<string, unknown>;
  steps?: unknown[];
  events?: CreativeWorkflowEvent[];
  artifacts?: CreativeWorkflowArtifact[];
  billingPreview?: unknown;
  billingPreviews?: unknown[];
  createTime?: number;
  updateTime?: number;
  createdAt?: string;
  updatedAt?: string;
  error?: unknown;
  [key: string]: unknown;
}

export interface StartCreativeWorkflowDependency {
  sourceStepId: string;
  targetArgument: string;
  transform:
    | 'artifact_url'
    | 'artifact_data_uri'
    | 'image_url'
    | 'video_url'
    | 'audio_url'
    | 'image_index'
    | 'video_index'
    | 'audio_index'
    | 'subtitle_cues'
    | 'subtitle_srt'
    | 'overlay_items'
    | 'asset_ref';
  sourceArtifactId?: string;
  sourceArtifactIndex?: number;
  mediaType?: 'image' | 'video' | 'audio';
  required?: boolean;
}

export interface StartCreativeWorkflowStep {
  id?: string;
  toolName: CreativeWorkflowHostedToolName;
  arguments: Record<string, unknown>;
  dependsOn?: StartCreativeWorkflowDependency[];
}

export interface StartCreativeWorkflowInput {
  title?: string;
  steps: StartCreativeWorkflowStep[];
}

export interface StartCreativeWorkflowParams {
  /**
   * Inline workflow definition. Use this for one-shot plans composed
   * client-side (e.g. the output of the `compose_workflow` chat tool).
   * Mutually exclusive with `workflowId`.
   */
  input?: StartCreativeWorkflowInput;
  /**
   * Run a saved workflow template by id. Combine with `inputs` to pass
   * the concrete user-supplied values (brief, aspect_ratio, etc.).
   * Mutually exclusive with `input`.
   */
  workflowId?: string;
  /**
   * Inputs for the saved template referenced by `workflowId`. The api
   * resolves these against the template's declared `inputs[]`.
   */
  inputs?: Record<string, unknown>;
  tokenType?: TokenType;
  appSource?: string;
  idempotencyKey?: string;
  /** Durable workflows require uploaded HTTP(S) URLs, not inline data URIs. */
  mediaReferences?: unknown[];
  maxEstimatedCapacityUnits?: number;
  confirmCost?: boolean;
  /** @internal Undocumented compatibility alias. Use workflowId. */
  workflow_id?: string;
  /** @internal Undocumented compatibility alias. Use tokenType. */
  token_type?: TokenType;
  /** @internal Undocumented compatibility alias. Use appSource. */
  app_source?: string;
  /** @internal Undocumented compatibility alias. Use idempotencyKey. */
  idempotency_key?: string;
  /** @internal Undocumented compatibility alias. Use mediaReferences. */
  media_references?: unknown[];
  /** @internal Undocumented compatibility alias. Use maxEstimatedCapacityUnits. */
  max_estimated_capacity_units?: number;
  /** @internal Undocumented compatibility alias. Use confirmCost. */
  confirm_cost?: boolean;
}

export interface ResumeCreativeWorkflowParams {
  /** Override the token type charged to the resumed run. */
  tokenType?: TokenType;
  /** Telemetry tag identifying the caller. */
  appSource?: string;
  /** @internal Undocumented compatibility alias. Use tokenType. */
  token_type?: TokenType;
  /** @internal Undocumented compatibility alias. Use appSource. */
  app_source?: string;
}

export interface ResumeCreativeWorkflowOptions {
  signal?: AbortSignal;
}

export interface ResumeCreativeWorkflowResult {
  workflow: CreativeWorkflowRecord;
  resumed: boolean;
}

export interface ReseedCreativeWorkflowParams {
  /**
   * Per-step seed overrides. Steps not listed in the map receive a fresh
   * random seed. Keys are the source workflow's step ids.
   */
  seedOverrides?: Record<string, number>;
  /** Override the token type charged to the new run. */
  tokenType?: TokenType;
  /** Telemetry tag identifying the caller. */
  appSource?: string;
  /** @internal Undocumented compatibility alias. Use seedOverrides. */
  seed_overrides?: Record<string, number>;
  /** @internal Undocumented compatibility alias. Use tokenType. */
  token_type?: TokenType;
  /** @internal Undocumented compatibility alias. Use appSource. */
  app_source?: string;
}

export interface ReseedCreativeWorkflowOptions {
  signal?: AbortSignal;
}

export interface ReseedCreativeWorkflowResult {
  workflow: CreativeWorkflowRecord;
  /**
   * The new run cloned from the source. Echoes the original run id plus
   * the step list with applied seed overrides.
   */
  reseed: {
    clonedFromRunId: string;
    steps: unknown[];
  };
}

export interface StartCreativeWorkflowOptions {
  signal?: AbortSignal;
}

export interface ListCreativeWorkflowOptions {
  limit?: number;
  offset?: number;
}

export interface StreamCreativeWorkflowEventsOptions {
  after?: string | number;
  lastEventId?: string | number;
  signal?: AbortSignal;
}

export interface CreativeWorkflowSseEvent {
  id?: string;
  event: string;
  data: unknown;
  raw: string;
}
