/**
 * Workflow template CRUD + fork (`/v1/creative-agent/workflows/templates`).
 *
 * Templates are the savable, parameterized blueprints behind workflow
 * runs. This sub-group reads the api the same way `CreativeWorkflowsApi`
 * reads the runs side — Bearer auth via `client.auth.authenticateRequest`,
 * shared error mapping. Exposed on the SDK as
 * `sogniClient.workflows.templates`.
 *
 * Behaviour:
 *   - Auth: relies on the SDK's active AuthManager (JWT or API key). No
 *     cookie path; if you need cookie auth, attach it via your own
 *     `client.auth` adapter before calling.
 *   - Errors: wraps non-2xx responses in `ApiError` with the api's
 *     `errorCode` + `message` when present.
 *   - Pagination: `list` returns `{ templates, nextCursor }`. Cursor is
 *     a numeric offset the api echoes when more results are available.
 */

import ApiGroup, { ApiConfig } from '../../ApiGroup.js';
import { ApiError } from '../../ApiClient/index.js';
import {
  ForkWorkflowTemplateBody,
  ListWorkflowTemplatesOptions,
  ListWorkflowTemplatesResult,
  WorkflowTemplate,
  WorkflowTemplateRequestOptions
} from './types.js';

interface TemplateEnvelope {
  template?: WorkflowTemplate;
  templates?: WorkflowTemplate[];
  next?: number | null;
  deleted?: boolean;
  id?: string;
  [key: string]: unknown;
}

interface RawJsonBody {
  status?: string;
  data?: unknown;
  message?: string;
  errorCode?: number;
  [key: string]: unknown;
}

// The api always wraps 2xx responses as `{ status: 'success', data: {...} }`.
// `toApiError` handles non-2xx, so this only runs on success — strip the
// envelope and surface the inner `data` object.
function parseSuccessEnvelope(text: string): TemplateEnvelope {
  if (!text) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const record = parsed as RawJsonBody;
  if (
    record.status === 'success' &&
    record.data &&
    typeof record.data === 'object' &&
    !Array.isArray(record.data)
  ) {
    return record.data as TemplateEnvelope;
  }
  return record as TemplateEnvelope;
}

function parseErrorEnvelope(text: string): RawJsonBody {
  if (!text) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as RawJsonBody;
    }
    return {};
  } catch {
    return { message: text };
  }
}

function isWorkflowTemplate(value: unknown): value is WorkflowTemplate {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === 'string' && typeof record.name === 'string';
}

class CreativeWorkflowTemplatesApi extends ApiGroup {
  constructor(config: ApiConfig) {
    super(config);
  }

  async list(options: ListWorkflowTemplatesOptions = {}): Promise<ListWorkflowTemplatesResult> {
    const query = new URLSearchParams();
    if (options.visibility) query.set('visibility', options.visibility);
    if (typeof options.offset === 'number' && options.offset >= 0) {
      query.set('offset', String(Math.floor(options.offset)));
    }
    if (typeof options.limit === 'number' && options.limit > 0) {
      query.set('limit', String(Math.min(Math.max(Math.floor(options.limit), 1), 200)));
    }
    const path = query.toString()
      ? `/v1/creative-agent/workflows/templates?${query.toString()}`
      : '/v1/creative-agent/workflows/templates';

    const data = await this.request(path, { method: 'GET', signal: options.signal });
    const templates = Array.isArray(data.templates)
      ? data.templates.filter(isWorkflowTemplate)
      : [];
    const nextCursor = typeof data.next === 'number' ? data.next : null;
    return { templates, nextCursor };
  }

  async get(id: string, options: WorkflowTemplateRequestOptions = {}): Promise<WorkflowTemplate> {
    const data = await this.request(
      `/v1/creative-agent/workflows/templates/${encodeURIComponent(id)}`,
      { method: 'GET', signal: options.signal }
    );
    if (!isWorkflowTemplate(data.template)) {
      throw new ApiError(500, {
        status: 'error',
        message: 'Workflow template response missing template field',
        errorCode: 0
      });
    }
    return data.template;
  }

  async create(
    template: WorkflowTemplate,
    options: WorkflowTemplateRequestOptions = {}
  ): Promise<WorkflowTemplate> {
    const data = await this.request('/v1/creative-agent/workflows/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(template),
      signal: options.signal
    });
    if (!isWorkflowTemplate(data.template)) {
      throw new ApiError(500, {
        status: 'error',
        message: 'Workflow template create response missing template field',
        errorCode: 0
      });
    }
    return data.template;
  }

  async update(
    id: string,
    patch: Partial<WorkflowTemplate>,
    options: WorkflowTemplateRequestOptions = {}
  ): Promise<WorkflowTemplate> {
    const data = await this.request(
      `/v1/creative-agent/workflows/templates/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
        signal: options.signal
      }
    );
    if (!isWorkflowTemplate(data.template)) {
      throw new ApiError(500, {
        status: 'error',
        message: 'Workflow template update response missing template field',
        errorCode: 0
      });
    }
    return data.template;
  }

  async delete(id: string, options: WorkflowTemplateRequestOptions = {}): Promise<void> {
    await this.request(`/v1/creative-agent/workflows/templates/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      signal: options.signal
    });
  }

  async fork(
    id: string,
    body: ForkWorkflowTemplateBody = {},
    options: WorkflowTemplateRequestOptions = {}
  ): Promise<WorkflowTemplate> {
    const data = await this.request(
      `/v1/creative-agent/workflows/templates/${encodeURIComponent(id)}/fork`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: options.signal
      }
    );
    if (!isWorkflowTemplate(data.template)) {
      throw new ApiError(500, {
        status: 'error',
        message: 'Workflow template fork response missing template field',
        errorCode: 0
      });
    }
    return data.template;
  }

  private async request(path: string, options: RequestInit = {}): Promise<TemplateEnvelope> {
    const response = await this.fetch(path, options);
    if (!response.ok) {
      throw await this.toApiError(response);
    }
    const text = await response.text();
    return parseSuccessEnvelope(text);
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
    const body = parseErrorEnvelope(await response.text());
    const message = typeof body.message === 'string' ? body.message : response.statusText;
    const errorCode = typeof body.errorCode === 'number' ? body.errorCode : 0;
    return new ApiError(response.status, { status: 'error', message, errorCode });
  }
}

// Internal: re-exported for the regression script under `scripts/`. Not part
// of the public API surface — direct callers should use the class methods.
export const __envelopeInternals = {
  parseSuccessEnvelope,
  parseErrorEnvelope,
  isWorkflowTemplate
};

export default CreativeWorkflowTemplatesApi;
export * from './types.js';
