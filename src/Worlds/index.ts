import ApiGroup, { ApiConfig } from '../ApiGroup.js';
import { apiErrorExtras, parseRetryAfterHeader } from '../lib/apiErrorFields.js';
import getUUID from '../lib/getUUID.js';
import { captureRequestSession } from '../lib/requestSession.js';
import type {
  ConfirmWorldBuildCostParams,
  ListWorldBuildsOptions,
  ReviewWorldBuildTaskParams,
  StartWorldBuildParams,
  StreamWorldBuildEventsOptions,
  WorldBuildEvent,
  WorldBuildRecord
} from './types.js';

interface Envelope<T> {
  status: string;
  data: T;
}

/**
 * Sogni Worlds, as the platform hosts them (`/v1/world-builds`).
 *
 * A hosted world build runs server-side with the account's own key: the
 * person starts it from a signed-in session, approves the quote, and approves
 * or rejects every finished take. API-key sessions cannot start one.
 *
 * - `builds.start` returns the persisted run (202); the executor prices the
 *   work and pauses with `waiting.reason: 'cost_approval_required'`.
 * - `builds.confirmCost` answers the quote: confirm, cancel or requote.
 * - `builds.review` records a verdict on a take in `review`; a rejection with
 *   a note sends it back for one rewrite.
 * - `builds.streamEvents` yields `WorldBuildEvent`s over SSE with
 *   `Last-Event-ID` replay; `builds.events` lists them.
 */
class WorldsApi extends ApiGroup {
  builds: {
    start: (params: StartWorldBuildParams) => Promise<WorldBuildRecord>;
    list: (options?: ListWorldBuildsOptions) => Promise<WorldBuildRecord[]>;
    get: (runId: string) => Promise<WorldBuildRecord>;
    events: (runId: string, afterSequence?: number) => Promise<WorldBuildEvent[]>;
    streamEvents: (runId: string, options?: StreamWorldBuildEventsOptions) => AsyncIterableIterator<WorldBuildEvent>;
    confirmCost: (runId: string, params: ConfirmWorldBuildCostParams) => Promise<WorldBuildRecord>;
    review: (runId: string, params: ReviewWorldBuildTaskParams) => Promise<WorldBuildRecord>;
    cancel: (runId: string, reason?: string) => Promise<WorldBuildRecord>;
  };

  constructor(config: ApiConfig) {
    super(config);
    this.builds = {
      start: this.startBuild.bind(this),
      list: this.listBuilds.bind(this),
      get: this.getBuild.bind(this),
      events: this.listBuildEvents.bind(this),
      streamEvents: this.streamBuildEvents.bind(this),
      confirmCost: this.confirmBuildCost.bind(this),
      review: this.reviewBuildTask.bind(this),
      cancel: this.cancelBuild.bind(this)
    };
  }

  /** An authenticated fetch bound to the current session: a session change cancels it. */
  private async buildFetch(path: string, options: RequestInit = {}): Promise<Response> {
    const assertSession = captureRequestSession(this.client.auth);
    const url = new URL(path, this.client.rest.baseUrl).toString();
    const controller = new AbortController();
    const cancelChangedSession = () => {
      try {
        assertSession();
      } catch (error) {
        controller.abort(error);
      }
    };
    const cancelRequested = () => controller.abort(options.signal?.reason);
    const offAuth = this.client.auth?.on('updated', cancelChangedSession);
    const offSession = this.client.auth?.on('sessionChanged', cancelChangedSession);
    if (options.signal?.aborted) cancelRequested();
    else options.signal?.addEventListener('abort', cancelRequested, { once: true });
    try {
      const authenticated = await this.client.auth.authenticateRequest(options);
      assertSession();
      const response = await fetch(url, { ...authenticated, signal: controller.signal });
      try {
        assertSession();
      } catch (error) {
        void response.body?.cancel().catch(() => undefined);
        throw error;
      }
      return response;
    } finally {
      offAuth?.();
      offSession?.();
      options.signal?.removeEventListener('abort', cancelRequested);
    }
  }

  private async buildJson<T>(path: string, options: RequestInit = {}): Promise<T> {
    const assertSession = captureRequestSession(this.client.auth);
    const response = await this.buildFetch(path, options);
    if (!response.ok) {
      const text = await response.text();
      assertSession();
      let payload: Record<string, unknown> | undefined;
      try {
        payload = text ? (JSON.parse(text) as Record<string, unknown>) : undefined;
      } catch {
        payload = { message: text };
      }
      const message =
        (payload && typeof payload.message === 'string' && payload.message) ||
        response.statusText ||
        `World build request failed with status ${response.status}`;
      // Same contract as the chat run surface: the server's message, its
      // status, its wait in seconds and any structured context it attached.
      const err = new Error(message) as Error & { status?: number; retryAfter?: number; details?: Record<string, unknown> };
      err.status = response.status;
      const extras = apiErrorExtras(payload);
      const retryAfter = extras.retryAfter ?? parseRetryAfterHeader(response.headers.get('retry-after'));
      if (retryAfter !== undefined) err.retryAfter = retryAfter;
      if (extras.details) err.details = extras.details;
      throw err;
    }
    const body = (await response.json()) as T;
    assertSession();
    return body;
  }

  private async startBuild(params: StartWorldBuildParams): Promise<WorldBuildRecord> {
    const appSource = this.client.appSource;
    const body: Record<string, unknown> = {
      worldId: params.worldId,
      nodeId: params.nodeId,
      hotspots: params.hotspots,
      ...(params.look ? { look: params.look } : {}),
      ...(params.audience ? { audience: params.audience } : {}),
      ...(params.tokenType ? { tokenType: params.tokenType } : {}),
      ...(params.billingMode ? { billingMode: params.billingMode } : {})
    };
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.attributionHeaders(appSource, undefined, getUUID())
    };
    if (params.idempotencyKey) headers['Idempotency-Key'] = params.idempotencyKey;
    const response = await this.buildJson<Envelope<{ run: WorldBuildRecord; idempotent?: boolean }>>('/v1/world-builds', {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });
    return response.data.run;
  }

  private async listBuilds(options: ListWorldBuildsOptions = {}): Promise<WorldBuildRecord[]> {
    const query = new URLSearchParams();
    if (options.worldId) query.set('worldId', options.worldId);
    if (options.limit !== undefined) query.set('limit', String(options.limit));
    const suffix = query.size ? `?${query.toString()}` : '';
    const response = await this.buildJson<Envelope<{ runs: WorldBuildRecord[] }>>(`/v1/world-builds${suffix}`);
    return response.data.runs;
  }

  private async getBuild(runId: string): Promise<WorldBuildRecord> {
    const response = await this.buildJson<Envelope<{ run: WorldBuildRecord }>>(`/v1/world-builds/${encodeURIComponent(runId)}`);
    return response.data.run;
  }

  private async listBuildEvents(runId: string, afterSequence?: number): Promise<WorldBuildEvent[]> {
    const suffix = afterSequence !== undefined ? `?after=${encodeURIComponent(String(afterSequence))}` : '';
    const response = await this.buildJson<Envelope<{ events: WorldBuildEvent[] }>>(
      `/v1/world-builds/${encodeURIComponent(runId)}/events${suffix}`
    );
    return response.data.events;
  }

  private async confirmBuildCost(runId: string, params: ConfirmWorldBuildCostParams): Promise<WorldBuildRecord> {
    const response = await this.buildJson<Envelope<{ run: WorldBuildRecord }>>(
      `/v1/world-builds/${encodeURIComponent(runId)}/confirm-cost`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision: params.decision }) }
    );
    return response.data.run;
  }

  private async reviewBuildTask(runId: string, params: ReviewWorldBuildTaskParams): Promise<WorldBuildRecord> {
    const response = await this.buildJson<Envelope<{ run: WorldBuildRecord }>>(
      `/v1/world-builds/${encodeURIComponent(runId)}/review`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: params.taskId, decision: params.decision, ...(params.note ? { note: params.note } : {}) })
      }
    );
    return response.data.run;
  }

  private async cancelBuild(runId: string, reason?: string): Promise<WorldBuildRecord> {
    const response = await this.buildJson<Envelope<{ run: WorldBuildRecord }>>(
      `/v1/world-builds/${encodeURIComponent(runId)}/cancel`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(reason ? { reason } : {}) }
    );
    return response.data.run;
  }

  /** SSE events, replayed from `lastEventId` and then live until the run ends or the signal aborts. */
  private async *streamBuildEvents(
    runId: string,
    options: StreamWorldBuildEventsOptions = {}
  ): AsyncIterableIterator<WorldBuildEvent> {
    const checkSession = captureRequestSession(this.client.auth);
    const assertSession = () => {
      checkSession();
      if (options.signal?.aborted) {
        throw options.signal.reason ?? new DOMException('The request was aborted', 'AbortError');
      }
    };
    const headers: Record<string, string> = { Accept: 'text/event-stream' };
    if (options.lastEventId !== undefined && Number.isFinite(options.lastEventId)) {
      headers['Last-Event-ID'] = String(options.lastEventId);
    }
    const response = await this.buildFetch(`/v1/world-builds/${encodeURIComponent(runId)}/events/stream`, {
      headers,
      signal: options.signal
    });
    if (!response.ok || !response.body) {
      throw new Error(`World build event stream failed with status ${response.status}`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const cancelChangedSession = () => {
      try {
        assertSession();
      } catch {
        void reader.cancel().catch(() => undefined);
      }
    };
    const offAuth = this.client.auth?.on('updated', cancelChangedSession);
    const offSession = this.client.auth?.on('sessionChanged', cancelChangedSession);
    options.signal?.addEventListener('abort', cancelChangedSession, { once: true });
    const findFrameBoundary = (source: string): { index: number; length: number } | null => {
      const lf = source.indexOf('\n\n');
      const crlf = source.indexOf('\r\n\r\n');
      if (lf === -1 && crlf === -1) return null;
      if (lf === -1) return { index: crlf, length: 4 };
      if (crlf === -1 || lf < crlf) return { index: lf, length: 2 };
      return { index: crlf, length: 4 };
    };
    const parseFrame = (frame: string): WorldBuildEvent | null => {
      if (!frame.trim() || frame.startsWith(':')) return null;
      let eventName = 'message';
      let data = '';
      for (const rawLine of frame.split(/\r?\n/)) {
        if (rawLine.startsWith('event:')) eventName = rawLine.slice(6).trim();
        else if (rawLine.startsWith('data:')) data += (data ? '\n' : '') + rawLine.slice(5).trim();
      }
      // run_status frames carry the run's status snapshot, not an event; `get` reads the same.
      if (eventName === 'run_status' || !data) return null;
      try {
        return JSON.parse(data) as WorldBuildEvent;
      } catch {
        return null;
      }
    };
    try {
      assertSession();
      while (true) {
        const { value, done } = await reader.read();
        assertSession();
        if (done) {
          const remaining = buffer.trim();
          if (remaining) {
            const parsed = parseFrame(remaining);
            if (parsed) yield parsed;
          }
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        let boundary = findFrameBoundary(buffer);
        while (boundary !== null) {
          const frame = buffer.slice(0, boundary.index);
          buffer = buffer.slice(boundary.index + boundary.length);
          boundary = findFrameBoundary(buffer);
          const parsed = parseFrame(frame);
          if (parsed) {
            assertSession();
            yield parsed;
          }
        }
      }
    } finally {
      offAuth?.();
      offSession?.();
      options.signal?.removeEventListener('abort', cancelChangedSession);
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }
}

export default WorldsApi;
