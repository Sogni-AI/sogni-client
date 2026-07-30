import type {
  AgentAttributionMetadata,
  AgentSurface,
  ConnectionAttribution,
  ExecutionMode,
  InteractionKind,
  OperationScope,
  WorkloadAttributionDefaults,
  WorkloadAttributionInput,
  WorkloadKind
} from '../types/attribution.js';

const MAX_METADATA_LENGTH = 128;
const MAX_VERSION_LENGTH = 32;
const MAX_OPERATION_ID_LENGTH = 128;
const UNSAFE_HEADER_CHARACTER = /[\u0000-\u001f\u007f]/;
const VERSION_PATTERN = /^[0-9][0-9A-Za-z.+_-]*$/;
const OPERATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

const INTERACTION_KINDS = new Set<InteractionKind>([
  'human_ui',
  'external_agent',
  'service',
  'unknown'
]);
const WORKLOAD_KINDS = new Set<WorkloadKind>(['direct', 'agent_mediated', 'service', 'unknown']);
const OPERATION_SCOPES = new Set<OperationScope>(['top_level', 'child', 'unknown']);
const AGENT_SURFACES = new Set<AgentSurface>([
  'native_web',
  'native_mobile',
  'native_desktop',
  'plugin',
  'personal_skill',
  'mcp',
  'cli',
  'sdk',
  'openai_compatible',
  'direct_api',
  'unknown'
]);
const EXECUTION_MODES = new Set<ExecutionMode>(['browser', 'durable', 'server', 'unknown']);

export type NormalizedConnectionAttribution = Partial<ConnectionAttribution>;
export type NormalizedWorkloadAttribution = WorkloadAttributionInput;

function normalizeEnum<T extends string>(value: unknown, allowed: ReadonlySet<T>): T | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return allowed.has(normalized as T) ? (normalized as T) : undefined;
}

function normalizeBoundedString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > maxLength ||
    UNSAFE_HEADER_CHARACTER.test(normalized)
  ) {
    return undefined;
  }
  return normalized;
}

function normalizeVersion(value: unknown): string | undefined {
  const normalized = normalizeBoundedString(value, MAX_VERSION_LENGTH);
  return normalized && VERSION_PATTERN.test(normalized) ? normalized : undefined;
}

function normalizeOperationId(value: unknown): string | undefined {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_OPERATION_ID_LENGTH ||
    value.trim() !== value ||
    UNSAFE_HEADER_CHARACTER.test(value) ||
    !OPERATION_ID_PATTERN.test(value)
  ) {
    return undefined;
  }
  return value;
}

function normalizeAgentMetadata(
  input: AgentAttributionMetadata | Record<string, unknown> | undefined
): AgentAttributionMetadata {
  if (!input || typeof input !== 'object') return {};
  const result: AgentAttributionMetadata = {};
  const agentFramework = normalizeBoundedString(input.agentFramework, MAX_METADATA_LENGTH);
  const agentFrameworkVersion = normalizeVersion(input.agentFrameworkVersion);
  const agentSurface = normalizeEnum(input.agentSurface, AGENT_SURFACES);
  const agentSurfaceVersion = normalizeVersion(input.agentSurfaceVersion);
  const executionMode = normalizeEnum(input.executionMode, EXECUTION_MODES);

  if (agentFramework) result.agentFramework = agentFramework;
  if (agentFrameworkVersion) result.agentFrameworkVersion = agentFrameworkVersion;
  if (agentSurface) result.agentSurface = agentSurface;
  if (agentSurfaceVersion) result.agentSurfaceVersion = agentSurfaceVersion;
  if (executionMode) result.executionMode = executionMode;
  return result;
}

function mergeDefined(defaults: object | undefined, overrides: object | undefined) {
  const merged: Record<string, unknown> = { ...(defaults ?? {}) };
  if (overrides && typeof overrides === 'object') {
    const defaultValues = (defaults ?? {}) as Record<string, unknown>;
    const overrideValues = overrides as Record<string, unknown>;
    for (const [key, value] of Object.entries(overrides)) {
      if (value !== undefined) merged[key] = value;
    }
    // A version belongs to its framework/surface. Do not accidentally retain
    // one default's version when a request changes the corresponding identity.
    if (
      overrideValues.agentFramework !== undefined &&
      overrideValues.agentFramework !== defaultValues.agentFramework &&
      overrideValues.agentFrameworkVersion === undefined
    ) {
      delete merged.agentFrameworkVersion;
    }
    if (
      overrideValues.agentSurface !== undefined &&
      overrideValues.agentSurface !== defaultValues.agentSurface &&
      overrideValues.agentSurfaceVersion === undefined
    ) {
      delete merged.agentSurfaceVersion;
    }
  }
  return merged;
}

function hasValues(value: object): boolean {
  return Object.keys(value).length > 0;
}

export function normalizeConnectionAttribution(
  input: ConnectionAttribution | Partial<ConnectionAttribution> | undefined
): NormalizedConnectionAttribution | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const result: NormalizedConnectionAttribution = normalizeAgentMetadata(input);
  const interactionKind = normalizeEnum(
    (input as unknown as Record<string, unknown>).interactionKind,
    INTERACTION_KINDS
  );
  if (interactionKind) result.interactionKind = interactionKind;
  return hasValues(result) ? result : undefined;
}

/**
 * Merge immutable client defaults with one operation's overrides and add
 * lineage derived from the underlying request ID. Invalid runtime values are
 * dropped instead of rejecting an otherwise valid inference request.
 */
export function resolveWorkloadAttribution(
  defaults: WorkloadAttributionDefaults | undefined,
  overrides: WorkloadAttributionInput | undefined,
  fallbackOperationId?: string
): NormalizedWorkloadAttribution | undefined {
  if (!defaults && !overrides) return undefined;

  const merged = mergeDefined(defaults, overrides);
  const result: NormalizedWorkloadAttribution = normalizeAgentMetadata(merged);
  const workloadKind = normalizeEnum(merged.workloadKind, WORKLOAD_KINDS);
  const operationScope = normalizeEnum(merged.operationScope, OPERATION_SCOPES);
  const operationId = normalizeOperationId(merged.operationId);
  const rootOperationId = normalizeOperationId(merged.rootOperationId);
  const parentOperationId = normalizeOperationId(merged.parentOperationId);

  if (workloadKind) result.workloadKind = workloadKind;
  if (operationScope) result.operationScope = operationScope;
  if (operationId) result.operationId = operationId;
  if (rootOperationId) result.rootOperationId = rootOperationId;
  if (parentOperationId) result.parentOperationId = parentOperationId;

  if (result.workloadKind && result.workloadKind !== 'agent_mediated') {
    delete result.agentFramework;
    delete result.agentFrameworkVersion;
  }

  // Do not turn an empty/invalid attribution object into attributed traffic
  // solely because the transport happens to have a request ID.
  if (!hasValues(result)) return undefined;

  if (!result.operationId) {
    const fallback = normalizeOperationId(fallbackOperationId);
    if (fallback) result.operationId = fallback;
  }

  if (result.operationId && !result.operationScope) {
    result.operationScope =
      result.parentOperationId ||
      (result.rootOperationId && result.rootOperationId !== result.operationId)
        ? 'child'
        : 'top_level';
  }

  if (result.operationScope === 'child' && result.rootOperationId && !result.parentOperationId) {
    result.parentOperationId = result.rootOperationId;
  }

  if (result.operationScope === 'top_level' && result.operationId) {
    result.rootOperationId = result.operationId;
    delete result.parentOperationId;
  }

  return result;
}

/** Add flat camelCase connection attribution fields to a WebSocket URL. */
export function appendConnectionAttributionQuery(
  url: URL,
  attribution: NormalizedConnectionAttribution | undefined
): void {
  if (!attribution) return;
  const fields: Array<keyof NormalizedConnectionAttribution> = [
    'interactionKind',
    'agentFramework',
    'agentFrameworkVersion',
    'agentSurface',
    'agentSurfaceVersion',
    'executionMode'
  ];
  for (const field of fields) {
    const value = attribution[field];
    if (typeof value === 'string') url.searchParams.set(field, value);
  }
}

/** Return flat camelCase workload fields for socket request payloads. */
export function workloadAttributionToWireFields(
  attribution: NormalizedWorkloadAttribution | undefined
): Record<string, string> {
  if (!attribution) return {};
  const result: Record<string, string> = {};
  for (const field of [
    'workloadKind',
    'agentFramework',
    'agentFrameworkVersion',
    'agentSurface',
    'agentSurfaceVersion',
    'executionMode',
    'operationScope',
    'operationId',
    'rootOperationId',
    'parentOperationId'
  ] as const) {
    const value = attribution[field];
    if (typeof value === 'string') result[field] = value;
  }
  return result;
}

export interface SogniAttributionHeaderInput {
  appSource?: string;
  connection?: NormalizedConnectionAttribution;
  workload?: NormalizedWorkloadAttribution;
}

/**
 * Build headers only for requests whose caller has already established that
 * the destination is a Sogni-owned endpoint.
 */
export function buildSogniAttributionHeaders({
  appSource,
  connection,
  workload
}: SogniAttributionHeaderInput): Record<string, string> {
  const headers: Record<string, string> = {};
  const normalizedAppSource = normalizeBoundedString(appSource, MAX_METADATA_LENGTH);
  if (normalizedAppSource) headers['X-App-Source'] = normalizedAppSource;
  if (connection?.interactionKind) {
    headers['X-Sogni-Interaction-Kind'] = connection.interactionKind;
  }
  if (workload?.workloadKind) {
    headers['X-Sogni-Workload-Kind'] = workload.workloadKind;
  }
  if (workload?.agentFramework) {
    headers['X-Sogni-Agent-Framework'] = workload.agentFramework;
  }
  if (workload?.agentFrameworkVersion) {
    headers['X-Sogni-Agent-Framework-Version'] = workload.agentFrameworkVersion;
  }
  if (workload?.agentSurface) {
    headers['X-Sogni-Agent-Surface'] = workload.agentSurface;
  }
  if (workload?.agentSurfaceVersion) {
    headers['X-Sogni-Agent-Surface-Version'] = workload.agentSurfaceVersion;
  }
  if (workload?.executionMode) {
    headers['X-Sogni-Execution-Mode'] = workload.executionMode;
  }
  if (workload?.operationScope) {
    headers['X-Sogni-Operation-Scope'] = workload.operationScope;
  }
  if (workload?.operationId) {
    headers['X-Sogni-Operation-Id'] = workload.operationId;
  }
  if (workload?.rootOperationId) {
    headers['X-Sogni-Root-Operation-Id'] = workload.rootOperationId;
  }
  if (workload?.parentOperationId) {
    headers['X-Sogni-Parent-Operation-Id'] = workload.parentOperationId;
  }
  return headers;
}
