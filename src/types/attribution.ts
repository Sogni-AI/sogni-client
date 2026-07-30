/**
 * How a caller is interacting with Sogni at the connection boundary.
 *
 * Connection attribution and workload attribution are intentionally separate:
 * a human-facing application can issue both direct and agent-mediated work on
 * the same connection.
 */
export type InteractionKind = 'human_ui' | 'external_agent' | 'service' | 'unknown';

/** How a logical Sogni workload was initiated. */
export type WorkloadKind = 'direct' | 'agent_mediated' | 'service' | 'unknown';

/** Whether an operation is a user-visible root or work performed on its behalf. */
export type OperationScope = 'top_level' | 'child' | 'unknown';

/** The integration surface used to reach Sogni. */
export type AgentSurface =
  | 'native_web'
  | 'native_mobile'
  | 'native_desktop'
  | 'plugin'
  | 'personal_skill'
  | 'mcp'
  | 'cli'
  | 'sdk'
  | 'openai_compatible'
  | 'direct_api'
  | 'unknown';

/** Optional execution detail for agent-mediated products. */
export type ExecutionMode = 'browser' | 'durable' | 'server' | 'unknown';

/** Agent metadata shared by connection and workload attribution. */
export interface AgentAttributionMetadata {
  /** Canonical agent host, for example `codex`, `claude-code`, or `sogni-chat`. */
  agentFramework?: string;
  /** Version of the agent host when known. */
  agentFrameworkVersion?: string;
  /** How the agent host integrated with Sogni. */
  agentSurface?: AgentSurface;
  /** Version of the integration surface when known. */
  agentSurfaceVersion?: string;
  /** Product execution detail, such as browser or durable execution. */
  executionMode?: ExecutionMode;
}

/** Attribution captured when the SDK opens a Sogni WebSocket connection. */
export interface ConnectionAttribution extends AgentAttributionMetadata {
  interactionKind: InteractionKind;
}

/**
 * Defaults applied independently to each attributed workload.
 *
 * Operation IDs do not belong in client-wide defaults because concurrent
 * requests must never share mutable lineage state.
 */
export interface WorkloadAttributionDefaults extends AgentAttributionMetadata {
  workloadKind: WorkloadKind;
}

/** Opaque identifiers that relate a request to its logical parent and root. */
export interface OperationLineage {
  operationScope: OperationScope;
  operationId: string;
  rootOperationId: string;
  parentOperationId?: string;
}

/**
 * Per-operation attribution input.
 *
 * Every property is optional so a request can override only one client
 * default. When attribution is present, the SDK supplies an operation ID from
 * the underlying project/job request when one is not provided.
 */
export interface WorkloadAttributionInput
  extends Partial<WorkloadAttributionDefaults>, Partial<OperationLineage> {}

/** Fully classified workload attribution after server normalization. */
export interface WorkloadAttribution extends AgentAttributionMetadata, OperationLineage {
  workloadKind: WorkloadKind;
}

/** Immutable attribution defaults configured when creating a client. */
export interface SogniAttributionConfig {
  connection?: ConnectionAttribution;
  workload?: WorkloadAttributionDefaults;
}
