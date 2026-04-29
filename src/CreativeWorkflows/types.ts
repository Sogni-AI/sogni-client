import { TokenType } from '../types/token';

export type CreativeWorkflowStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | string;

export type CreativeWorkflowKind = 'image_to_video' | 'hosted_tool_sequence' | string;
export type CreativeWorkflowHostedToolName =
  | 'sogni_generate_image'
  | 'sogni_edit_image'
  | 'sogni_generate_video'
  | 'sogni_sound_to_video'
  | 'sogni_video_to_video'
  | 'sogni_generate_music';

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
  kind?: CreativeWorkflowKind;
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

export interface StartImageToVideoWorkflowInput {
  prompt: string;
  videoPrompt?: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  duration?: number;
  imageModel?: string;
  videoModel?: string;
  numberOfMedia?: number;
  seed?: number;
  [key: string]: unknown;
}

export interface StartHostedToolSequenceWorkflowDependency {
  sourceStepId: string;
  targetArgument: string;
  transform: 'artifact_url' | 'artifact_data_uri';
  sourceArtifactId?: string;
  sourceArtifactIndex?: number;
  mediaType?: 'image' | 'video' | 'audio';
  required?: boolean;
}

export interface StartHostedToolSequenceWorkflowStep {
  id?: string;
  toolName: CreativeWorkflowHostedToolName;
  arguments: Record<string, unknown>;
  dependsOn?: StartHostedToolSequenceWorkflowDependency[];
}

export interface StartHostedToolSequenceWorkflowInput {
  title?: string;
  steps: StartHostedToolSequenceWorkflowStep[];
  [key: string]: unknown;
}

export type StartCreativeWorkflowParams =
  | {
      kind: 'image_to_video';
      input: StartImageToVideoWorkflowInput;
      tokenType?: TokenType;
      token_type?: TokenType;
    }
  | {
      kind: 'hosted_tool_sequence';
      input: StartHostedToolSequenceWorkflowInput;
      tokenType?: TokenType;
      token_type?: TokenType;
    };

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
