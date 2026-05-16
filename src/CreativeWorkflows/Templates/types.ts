/**
 * Workflow template types — mirrors the api `workflow_templates` collection.
 *
 * The SDK keeps a structural shape with the well-known fields typed and a
 * `[key: string]: unknown` escape hatch so callers that hold a richer type
 * (e.g. `@sogni/creative-agent/workflows`) can cast safely without the SDK
 * needing to depend on that package.
 */

export type WorkflowTemplateVisibility = 'private' | 'public' | 'team';
export type WorkflowTemplateVisibilityFilter = 'own' | 'public' | 'all';

export type WorkflowTemplateAuthor = 'system' | { userId: string; displayName: string };

export type WorkflowTemplateStability = 'experimental' | 'beta' | 'production';

export interface WorkflowTemplate {
  id: string;
  name: string;
  version: string;
  description: string;
  category?: string;
  stability?: WorkflowTemplateStability;
  author?: WorkflowTemplateAuthor;
  visibility?: WorkflowTemplateVisibility;
  inputs?: unknown[];
  stages?: unknown[];
  exposeToLLM?: boolean;
  llmPriority?: number;
  estimatedCredits?: { min: number; max: number };
  estimatedCapacityUnits?: { min: number; max: number };
  tags?: string[];
  createdAt?: number | string;
  updatedAt?: number | string;
  [key: string]: unknown;
}

export interface ListWorkflowTemplatesOptions {
  visibility?: WorkflowTemplateVisibilityFilter;
  offset?: number;
  limit?: number;
  signal?: AbortSignal;
}

export interface ListWorkflowTemplatesResult {
  templates: WorkflowTemplate[];
  nextCursor: number | null;
}

export interface WorkflowTemplateRequestOptions {
  signal?: AbortSignal;
}

export interface ForkWorkflowTemplateBody {
  newName?: string;
}
