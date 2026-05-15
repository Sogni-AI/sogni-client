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

import ApiGroup, { ApiConfig } from '../../ApiGroup';
import { ApiError } from '../../ApiClient';
import {
  ForkWorkflowTemplateBody,
  ListWorkflowTemplatesOptions,
  ListWorkflowTemplatesResult,
  WorkflowTemplate,
  WorkflowTemplateRequestOptions
} from './types';

interface TemplateEnvelope {
  template?: WorkflowTemplate;
  templates?: WorkflowTemplate[];
  nextCursor?: number | null;
  status?: string;
  message?: string;
  errorCode?: number;
  [key: string]: unknown;
}

function parseJsonResponse(text: string): TemplateEnvelope {
  if (!text) return {};
  try {
    return JSON.parse(text) as TemplateEnvelope;
  } catch {
    return { status: 'error', message: text, errorCode: 0 };
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

    const body = await this.request(path, { method: 'GET', signal: options.signal });
    const templates = Array.isArray(body.templates)
      ? body.templates.filter(isWorkflowTemplate)
      : [];
    const nextCursor = typeof body.nextCursor === 'number' ? body.nextCursor : null;
    return { templates, nextCursor };
  }

  async get(id: string, options: WorkflowTemplateRequestOptions = {}): Promise<WorkflowTemplate> {
    const body = await this.request(
      `/v1/creative-agent/workflows/templates/${encodeURIComponent(id)}`,
      { method: 'GET', signal: options.signal }
    );
    if (!isWorkflowTemplate(body.template)) {
      throw new ApiError(500, {
        status: 'error',
        message: 'Workflow template response missing template field',
        errorCode: 0
      });
    }
    return body.template;
  }

  async create(
    template: WorkflowTemplate,
    options: WorkflowTemplateRequestOptions = {}
  ): Promise<WorkflowTemplate> {
    const body = await this.request('/v1/creative-agent/workflows/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(template),
      signal: options.signal
    });
    if (!isWorkflowTemplate(body.template)) {
      throw new ApiError(500, {
        status: 'error',
        message: 'Workflow template create response missing template field',
        errorCode: 0
      });
    }
    return body.template;
  }

  async update(
    id: string,
    patch: Partial<WorkflowTemplate>,
    options: WorkflowTemplateRequestOptions = {}
  ): Promise<WorkflowTemplate> {
    const body = await this.request(
      `/v1/creative-agent/workflows/templates/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
        signal: options.signal
      }
    );
    if (!isWorkflowTemplate(body.template)) {
      throw new ApiError(500, {
        status: 'error',
        message: 'Workflow template update response missing template field',
        errorCode: 0
      });
    }
    return body.template;
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
    const response = await this.request(
      `/v1/creative-agent/workflows/templates/${encodeURIComponent(id)}/fork`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: options.signal
      }
    );
    if (!isWorkflowTemplate(response.template)) {
      throw new ApiError(500, {
        status: 'error',
        message: 'Workflow template fork response missing template field',
        errorCode: 0
      });
    }
    return response.template;
  }

  private async request(path: string, options: RequestInit = {}): Promise<TemplateEnvelope> {
    const response = await this.fetch(path, options);
    if (!response.ok) {
      throw await this.toApiError(response);
    }
    const text = await response.text();
    return parseJsonResponse(text);
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
    const body = parseJsonResponse(await response.text());
    const payload = body.status === 'error' ? body : (body as Record<string, unknown>);
    const message = typeof payload.message === 'string' ? payload.message : response.statusText;
    const errorCode = typeof payload.errorCode === 'number' ? payload.errorCode : 0;
    return new ApiError(response.status, { status: 'error', message, errorCode });
  }
}

export default CreativeWorkflowTemplatesApi;
export * from './types';
