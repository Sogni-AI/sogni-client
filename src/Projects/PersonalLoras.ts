import type RestClient from '../lib/RestClient.js';
import type { ApiResponse } from '../ApiClient/index.js';
import type { LoraCatalogEntry } from './types/LoraCatalog.js';

/** An import in the authenticated account's private LoRA library. */
export interface PersonalLora {
  id: string;
  name: string;
  modelId: string;
  modelIds: string[];
  source: string;
  status: 'queued' | 'validating' | 'review' | 'ready' | 'rejected' | 'revoked';
  createdAt: number;
  updatedAt: number;
  bytes?: number;
  reason?: string;
  failureCode?: 'source_access' | 'subscription_required' | 'catalog_duplicate' | 'invalid_artifact';
  /** Requirements to observe when generating with this import. */
  requirements: string[];
}

export interface PersonalLoraLibrary {
  loras: PersonalLora[];
  /** Supported import targets; discover these instead of hard-coding model ids. */
  models: string[];
  limits: {
    entries: number;
    fileBytes: number | null;
    importsPerDay: number;
    perGeneration: number;
  };
}

export interface ImportPersonalLoraParams {
  /** Public Hugging Face safetensors link or Civitai model/version link. */
  url: string;
  name: string;
  modelId: string;
  /** Explicit confirmation of permission to use the file on Sogni. */
  rightsConfirmed: boolean;
}

/** Manage personal imports using the client's API key or signed-in session. */
export default class PersonalLoras {
  private session = 0;

  constructor(private readonly rest: RestClient) {
    rest.auth?.on('updated', () => { this.session += 1; });
  }

  private async read<T>(path: string): Promise<T> {
    const session = this.session;
    const response = await this.rest.get<ApiResponse<T>>(path);
    if (session !== this.session) throw new Error('The account changed. Refresh your LoRA library.');
    return response.data;
  }

  /** List imports and statuses, including after a subscription lapses. */
  list(): Promise<PersonalLoraLibrary> {
    return this.read('/v1/loras/personal');
  }

  /** Current status of one owned import; unavailable ids return 404. */
  get(id: string): Promise<PersonalLora> {
    return this.read(`/v1/loras/personal/${encodeURIComponent(id)}`);
  }

  /** Start an import. Poll get() until ready, rejected, or revoked. */
  async import(params: ImportPersonalLoraParams): Promise<PersonalLora> {
    const session = this.session;
    const response = await this.rest.post<ApiResponse<PersonalLora>>('/v1/loras/personal', { ...params });
    if (session !== this.session) throw new Error('The account changed. Refresh your LoRA library.');
    return response.data;
  }

  /** Remove an owned entry, including after a subscription lapses. */
  async remove(id: string): Promise<void> {
    await this.rest.delete(`/v1/loras/personal/${encodeURIComponent(id)}`);
  }

  /** Ready imports with model compatibility and strength ranges; never cached. */
  async catalog(params: { modelId?: string } = {}): Promise<{ loras: LoraCatalogEntry[] }> {
    const { loras } = await this.read<{ loras: LoraCatalogEntry[] }>('/v1/loras/personal/catalog');
    return { loras: params.modelId ? loras.filter(row => row.modelIds.includes(params.modelId!)) : loras };
  }
}
