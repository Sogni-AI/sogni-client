/**
 * Hosted world builds (`/v1/world-builds`): sogni-api builds the paths,
 * moments and collectibles a person chose for one scene of their Sogni
 * World, in the background, with the account's own key. The person starts
 * it from a signed-in session, approves the quote before anything paid, and
 * approves or rejects every finished take; publication stays theirs in the
 * World studio. Shapes mirror sogni-api `src/interface/world-build.interface.ts`.
 */

export type WorldBuildStatus =
  | 'queued'
  | 'running'
  | 'waiting_for_user'
  | 'completed'
  | 'partial_failure'
  | 'failed'
  | 'cancelled';

export type WorldBuildWaitingReason =
  | 'cost_approval_required'
  | 'review_required'
  | 'insufficient_credit'
  | 'safety_review_required';

export interface WorldBuildWaiting {
  reason: WorldBuildWaitingReason;
  message: string;
  details?: Record<string, unknown>;
  since: string;
}

export type WorldBuildHotspotKind = 'path' | 'moment' | 'collectible';

export interface WorldBuildAction {
  verb: string;
  subject: string;
  intent: string;
  tone?: string;
}

/** One thing to build from the scene. `taskId` is optional; the server names unnamed ones `task_<n>`. */
export interface WorldBuildHotspotInput {
  taskId?: string;
  kind: WorldBuildHotspotKind;
  /** The object as it appears in the picture, lower case with its article: "the brass lantern". */
  object: string;
  action: WorldBuildAction;
  /** A path's destination title. */
  leadsTo?: string;
  /** Film length in seconds; one of the world's creator-plan lengths. */
  duration?: number;
  /** Where the person or the finder saw it, as fractions of the picture: a hint for the pointer. */
  point?: { x: number; y: number };
}

export interface StartWorldBuildParams {
  worldId: string;
  nodeId: string;
  hotspots: WorldBuildHotspotInput[];
  /** The world's visual style, carried into every film direction. */
  look?: string;
  audience?: 'everyone' | 'teen';
  tokenType?: 'spark' | 'sogni';
  billingMode?: 'auto' | 'subscription' | 'tokens';
  /** Replays with the same key return the same run instead of starting another. */
  idempotencyKey?: string;
}

export type WorldBuildTaskStep =
  | 'pending'
  | 'locating'
  | 'outlining'
  | 'reserving'
  | 'rendering_still'
  | 'directing'
  | 'rendering_transition'
  | 'rendering_moment'
  | 'rendering_collectible'
  | 'review'
  | 'approved'
  | 'rejected'
  | 'failed'
  | 'cancelled';

export interface WorldBuildTaskSelection {
  id: string;
  selectionHash: string;
  projectId: string;
  points: Array<{ x: number; y: number; label: 'positive' | 'negative' }>;
  bounds: { x: number; y: number; width: number; height: number };
  coverage: number;
}

export interface WorldBuildTask {
  taskId: string;
  kind: WorldBuildHotspotKind;
  status: WorldBuildTaskStep;
  attempts: number;
  selection?: WorldBuildTaskSelection;
  /** The World generation behind a path; publish it through the World studio once approved. */
  generationId?: string;
  /** The World interaction behind a moment or collectible. */
  interactionId?: string;
  projects: { segmentation?: string; target_still?: string; transition?: string; interaction?: string };
  direction?: string;
  review?: { decision: 'approved' | 'rejected'; note?: string; at: string };
  error?: { message: string; code?: string; at: string; step: WorldBuildTaskStep };
  startedAt?: string;
  finishedAt?: string;
}

export interface WorldBuildCostLine {
  taskId: string;
  kind: WorldBuildHotspotKind;
  stages: Record<string, number>;
  total: number;
}

export interface WorldBuildCostPreview {
  tokenType: 'spark' | 'sogni';
  billingMode: 'auto' | 'subscription' | 'tokens';
  lines: WorldBuildCostLine[];
  total: number;
  coveredBySubscription: boolean;
  issuedAt: string;
  /** Confirm before this, or ask for a requote. */
  validUntil: string;
}

export interface WorldBuildEvent {
  sequence: number;
  type: string;
  at: string;
  payload?: Record<string, unknown>;
}

export interface WorldBuildRecord {
  runId: string;
  ownerWalletAddress: string;
  worldId: string;
  nodeId: string;
  status: WorldBuildStatus;
  scope: { ownerWalletAddress: string; appSource: string; tokenType?: 'spark' | 'sogni'; billingMode?: 'auto' | 'subscription' | 'tokens' };
  input: {
    worldId: string;
    nodeId: string;
    look?: string;
    audience?: 'everyone' | 'teen';
    hotspots: Array<Required<Pick<WorldBuildHotspotInput, 'taskId'>> & WorldBuildHotspotInput>;
    plan: Record<string, unknown>;
  };
  tasks: WorldBuildTask[];
  costPreview?: WorldBuildCostPreview;
  authorization?: { acceptedTotal: number; tokenType: 'spark' | 'sogni'; previewIssuedAt: string; acceptedAt: string };
  waiting?: WorldBuildWaiting;
  /** Absent from list responses: a build's events are a stream, read with `events` or `streamEvents`. */
  events?: WorldBuildEvent[];
  failureReason?: string;
  cancellationReason?: string;
  timestamps: { createdAt: string; updatedAt: string; completedAt?: string };
}

export interface ConfirmWorldBuildCostParams {
  /** `confirm` starts the paid work, `cancel` ends the run, `requote` asks for a fresh price. */
  decision: 'confirm' | 'cancel' | 'requote';
}

export interface ReviewWorldBuildTaskParams {
  taskId: string;
  decision: 'approved' | 'rejected';
  /** What is wrong with a rejected take; the rewrite reads it. */
  note?: string;
}

export interface ListWorldBuildsOptions {
  worldId?: string;
  limit?: number;
}

export interface StreamWorldBuildEventsOptions {
  /** Last event sequence observed by the caller; replay starts after it. */
  lastEventId?: number;
  signal?: AbortSignal;
}
