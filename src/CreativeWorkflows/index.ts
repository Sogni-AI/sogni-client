import ApiGroup, { ApiConfig } from '../ApiGroup';
import { ApiError, ApiResponse } from '../ApiClient';
import {
  CreativeWorkflowRecord,
  CreativeWorkflowEvent,
  CreativeWorkflowSseEvent,
  ListCreativeWorkflowOptions,
  StartCreativeWorkflowOptions,
  StartCreativeWorkflowParams,
  StreamCreativeWorkflowEventsOptions
} from './types';

interface CreativeWorkflowEnvelope {
  workflow?: CreativeWorkflowRecord;
  workflows?: CreativeWorkflowRecord[];
  events?: CreativeWorkflowEvent[];
  cancelled?: boolean;
  [key: string]: unknown;
}

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);

function toQuery(params: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      query.set(key, String(value));
    }
  }
  const serialized = query.toString();
  return serialized ? `?${serialized}` : '';
}

function isTerminalWorkflowStatus(value: unknown): boolean {
  return typeof value === 'string' && TERMINAL_STATUSES.has(value);
}

function parseJsonResponse(text: string): unknown {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { status: 'error', message: text, errorCode: 0 };
  }
}

function parseEnvelope<T>(response: ApiResponse<CreativeWorkflowEnvelope>, key: string): T {
  const data = response.data;
  if (!data || typeof data !== 'object') {
    throw new Error('Creative workflow response did not include data');
  }
  if (!(key in data)) {
    throw new Error(`Creative workflow response did not include data.${key}`);
  }
  return data[key] as T;
}

export function parseCreativeWorkflowSseChunk(chunk: string): CreativeWorkflowSseEvent[] {
  return chunk
    .split(/\r?\n\r?\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const frame: CreativeWorkflowSseEvent = {
        event: 'message',
        data: null,
        raw: block
      };
      const dataLines: string[] = [];

      for (const line of block.split(/\r?\n/)) {
        if (!line || line.startsWith(':')) continue;
        const separator = line.indexOf(':');
        const field = separator === -1 ? line : line.slice(0, separator);
        const value = separator === -1 ? '' : line.slice(separator + 1).replace(/^ /, '');

        if (field === 'id') {
          frame.id = value;
        } else if (field === 'event') {
          frame.event = value || 'message';
        } else if (field === 'data') {
          dataLines.push(value);
        }
      }

      const data = dataLines.join('\n');
      if (data) {
        try {
          frame.data = JSON.parse(data);
        } catch {
          frame.data = data;
        }
      }

      return frame;
    });
}

class CreativeWorkflowsApi extends ApiGroup {
  constructor(config: ApiConfig) {
    super(config);
  }

  async start(
    params: StartCreativeWorkflowParams,
    options: StartCreativeWorkflowOptions = {}
  ): Promise<CreativeWorkflowRecord> {
    const tokenType = params.tokenType ?? params.token_type;
    const appSource = params.appSource ?? params.app_source;
    const idempotencyKey = params.idempotencyKey ?? params.idempotency_key;
    const mediaReferences = params.mediaReferences ?? params.media_references;
    const maxEstimatedCapacityUnits =
      params.maxEstimatedCapacityUnits ?? params.max_estimated_capacity_units;
    const confirmCost = params.confirmCost ?? params.confirm_cost;

    const body: Record<string, unknown> = {
      input: params.input
    };
    if (tokenType) body.token_type = tokenType;
    if (appSource) body.app_source = appSource;
    if (maxEstimatedCapacityUnits !== undefined) {
      body.max_estimated_capacity_units = maxEstimatedCapacityUnits;
    }
    if (confirmCost !== undefined) body.confirm_cost = confirmCost;
    if (mediaReferences !== undefined) body.media_references = mediaReferences;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (idempotencyKey) {
      headers['Idempotency-Key'] = idempotencyKey;
    }

    const response = await this.request<CreativeWorkflowEnvelope>('/v1/creative-agent/workflows', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: options.signal
    });
    return parseEnvelope<CreativeWorkflowRecord>(response, 'workflow');
  }

  async list(options: ListCreativeWorkflowOptions = {}): Promise<CreativeWorkflowRecord[]> {
    const response = await this.request<CreativeWorkflowEnvelope>(
      `/v1/creative-agent/workflows${toQuery({
        limit: options.limit,
        offset: options.offset
      })}`
    );
    return parseEnvelope<CreativeWorkflowRecord[]>(response, 'workflows');
  }

  async get(workflowId: string): Promise<CreativeWorkflowRecord> {
    const response = await this.request<CreativeWorkflowEnvelope>(
      `/v1/creative-agent/workflows/${encodeURIComponent(workflowId)}`
    );
    return parseEnvelope<CreativeWorkflowRecord>(response, 'workflow');
  }

  async events(workflowId: string): Promise<CreativeWorkflowEvent[]> {
    const response = await this.request<CreativeWorkflowEnvelope>(
      `/v1/creative-agent/workflows/${encodeURIComponent(workflowId)}/events`
    );
    return parseEnvelope<CreativeWorkflowEvent[]>(response, 'events');
  }

  async cancel(workflowId: string): Promise<CreativeWorkflowRecord> {
    const response = await this.request<CreativeWorkflowEnvelope>(
      `/v1/creative-agent/workflows/${encodeURIComponent(workflowId)}/cancel`,
      {
        method: 'POST'
      }
    );
    return parseEnvelope<CreativeWorkflowRecord>(response, 'workflow');
  }

  async *streamEvents(
    workflowId: string,
    options: StreamCreativeWorkflowEventsOptions = {}
  ): AsyncIterableIterator<CreativeWorkflowSseEvent> {
    const after = options.after ?? options.lastEventId;
    const query = toQuery({ after });
    const headers: Record<string, string> = {
      Accept: 'text/event-stream'
    };
    if (options.lastEventId !== undefined) {
      headers['Last-Event-ID'] = String(options.lastEventId);
    }

    const response = await this.fetch(
      `/v1/creative-agent/workflows/${encodeURIComponent(workflowId)}/events/stream${query}`,
      {
        method: 'GET',
        headers,
        signal: options.signal
      }
    );

    if (!response.ok) {
      throw await this.toApiError(response);
    }
    if (!response.body) {
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split(/\r?\n\r?\n/);
        buffer = parts.pop() ?? '';

        for (const frame of parseCreativeWorkflowSseChunk(parts.join('\n\n'))) {
          yield frame;
          const data = frame.data as { status?: unknown } | null;
          if (data && isTerminalWorkflowStatus(data.status)) {
            await reader.cancel();
            return;
          }
        }
      }

      buffer += decoder.decode();
      for (const frame of parseCreativeWorkflowSseChunk(buffer)) {
        yield frame;
      }
    } finally {
      reader.releaseLock();
    }
  }

  private async request<T = CreativeWorkflowEnvelope>(
    path: string,
    options: RequestInit = {}
  ): Promise<ApiResponse<T>> {
    const response = await this.fetch(path, options);
    if (!response.ok) {
      throw await this.toApiError(response);
    }
    return (await response.json()) as ApiResponse<T>;
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
    const body = parseJsonResponse(await response.text()) as Record<string, unknown>;
    const payload =
      body.status === 'error' ? body : ((body.data as Record<string, unknown>) ?? body);
    return new ApiError(response.status, {
      status: 'error',
      message: typeof payload.message === 'string' ? payload.message : response.statusText,
      errorCode: typeof payload.errorCode === 'number' ? payload.errorCode : 0
    });
  }
}

export default CreativeWorkflowsApi;
export * from './types';
