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
  input: StartCreativeWorkflowInput;
  tokenType?: TokenType;
  appSource?: string;
  idempotencyKey?: string;
  mediaReferences?: unknown[];
  maxEstimatedCapacityUnits?: number;
  confirmCost?: boolean;
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
