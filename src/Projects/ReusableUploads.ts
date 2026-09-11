import type RestClient from '../lib/RestClient.js';
import { ApiError, type ApiResponse } from '../ApiClient/index.js';

export interface SavedUpload {
  id: string;
  name: string;
  bytes: number;
  contentType: string;
  state: 'uploading' | 'ready';
  createdAt: number;
  expiresAt: number;
}
export interface SavedUploadBinding {
  projectId: string;
  type: string;
  id?: string;
}
interface PreparedUpload extends SavedUpload {
  reused: boolean;
  uploadUrl?: string;
  uploadHeaders?: Record<string, string>;
}
const SUPPORTED_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'audio/mp4',
  'audio/mpeg',
  'audio/flac',
  'audio/wav',
  'audio/x-wav',
  'audio/wave'
]);

/** Private subscriber uploads that can be reused across projects. */
export default class ReusableUploads {
  private pending = new Map<string, Promise<SavedUpload>>();
  // Bound hashing/upload memory even when a project has many reference files.
  private lanes: Promise<unknown>[] = [Promise.resolve(), Promise.resolve()];
  private nextLane = 0;
  private session = 0;
  private availability?: { expiresAt: number; result: Promise<boolean> };
  private preparationFailures = new WeakSet<Error>();
  constructor(private readonly rest: RestClient) {
    rest.auth?.on('updated', () => {
      this.session += 1;
      this.pending.clear();
      this.availability = undefined;
    });
  }

  private assertSession(session: number) {
    if (session !== this.session) throw new Error('The account changed. Select the upload again.');
  }

  private canAutomaticallySave(): Promise<boolean> {
    if (this.availability && this.availability.expiresAt > Date.now())
      return this.availability.result;
    const result = this.rest
      .get<ApiResponse<{ enabled: boolean }>>('/v1/assets/capabilities')
      .then((response) => response.data.enabled === true)
      .catch((error) => {
        if (error instanceof ApiError && [403, 404, 503].includes(error.status)) return false;
        this.availability = undefined;
        throw error;
      });
    this.availability = { expiresAt: Date.now() + 60000, result };
    return result;
  }

  async list() {
    const result = await this.rest.get<
      ApiResponse<{
        assets: SavedUpload[];
        limits: {
          entries: number;
          bytes: number;
          fileBytes: number;
          idleDays: number;
          copyBytesPerDay: number;
          bindingsPerDay: number;
        };
      }>
    >('/v1/assets');
    return result.data;
  }

  async remove(id: string): Promise<void> {
    await this.rest.delete(`/v1/assets/${encodeURIComponent(id)}`);
  }

  async bind(id: string, binding: SavedUploadBinding): Promise<void> {
    const session = this.session;
    await this.retryBusy(() => {
      this.assertSession(session);
      return this.rest.post(`/v1/assets/${encodeURIComponent(id)}/bind`, { ...binding });
    });
    this.assertSession(session);
  }

  private async retryBusy<T>(operation: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 423 || attempt >= 4) throw error;
        await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
      }
    }
  }

  /** Upload once; the API verifies the file before making it reusable. */
  upload(file: Blob | Buffer, contentType: string, name = 'Saved upload'): Promise<SavedUpload> {
    const session = this.session;
    const size = file instanceof Blob ? file.size : file.byteLength;
    if (!size || size > 100 * 1024 * 1024)
      return Promise.reject(
        new ApiError(400, {
          status: 'error',
          errorCode: 0,
          message: 'Choose a saved upload no larger than 100 MiB.'
        })
      );
    const lane = this.nextLane++ % this.lanes.length;
    const run = this.lanes[lane].then(async () => {
      this.assertSession(session);
      const bytes = file instanceof Blob ? await file.arrayBuffer() : file;
      const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes as BufferSource);
      this.assertSession(session);
      const sha256 = Array.from(new Uint8Array(digest), (value) =>
        value.toString(16).padStart(2, '0')
      ).join('');
      const key = `${sha256}:${contentType}`;
      const existing = this.pending.get(key);
      if (existing) return existing;
      const task = this.performUpload(file, bytes.byteLength, sha256, contentType, name, session);
      this.pending.set(key, task);
      try {
        return await task;
      } finally {
        if (this.pending.get(key) === task) this.pending.delete(key);
      }
    });
    this.lanes[lane] = run.catch(() => undefined);
    return run;
  }

  private async performUpload(
    file: Blob | Buffer,
    bytes: number,
    sha256: string,
    contentType: string,
    name: string,
    session: number
  ): Promise<SavedUpload> {
    const result = await this.retryBusy(() => {
      this.assertSession(session);
      return this.rest.post<ApiResponse<PreparedUpload>>('/v1/assets/prepare', {
        sha256,
        bytes,
        contentType,
        name
      });
    }).catch((error) => {
      if (error instanceof Error) this.preparationFailures.add(error);
      throw error;
    });
    this.assertSession(session);
    const prepared = result.data;
    if (prepared.state === 'ready') return prepared;
    if (!prepared.uploadUrl || !prepared.uploadHeaders)
      throw new Error('The saved upload could not be prepared.');
    const body = file instanceof Blob ? file : new Blob([new Uint8Array(file)]);
    const response = await fetch(prepared.uploadUrl, {
      method: 'PUT',
      body,
      headers: prepared.uploadHeaders,
      redirect: 'error',
      credentials: 'omit',
      signal: AbortSignal.timeout(300000)
    });
    this.assertSession(session);
    // A concurrent/retried write-once upload may already have finished. The
    // server still verifies the stored bytes before acknowledging completion.
    if (!response.ok && response.status !== 412)
      throw new ApiError(response.status, {
        status: 'error',
        errorCode: 0,
        message: 'Could not upload the selected file.'
      });
    const finalized = await this.retryBusy(() => {
      this.assertSession(session);
      return this.rest.post<ApiResponse<SavedUpload>>(
        `/v1/assets/${encodeURIComponent(prepared.id)}/finalize`
      );
    });
    this.assertSession(session);
    return finalized.data;
  }

  /** Existing project uploads remain available when saved uploads cannot be used. */
  async tryBindFile(
    file: Blob | Buffer,
    contentType: string | undefined,
    binding: SavedUploadBinding
  ): Promise<boolean> {
    const size = file instanceof Blob ? file.size : file.byteLength;
    if (!contentType || !SUPPORTED_TYPES.has(contentType) || !size || size > 100 * 1024 * 1024)
      return false;
    const session = this.session;
    if (!(await this.canAutomaticallySave())) return false;
    this.assertSession(session);
    try {
      const saved = await this.upload(
        file,
        contentType,
        file instanceof Blob && 'name' in file && typeof file.name === 'string'
          ? file.name
          : 'Saved upload'
      );
      this.assertSession(session);
      await this.bind(saved.id, binding);
      return true;
    } catch (error) {
      // Fallback is permitted only before a transfer was prepared. Checksum,
      // storage-access and binding failures must surface before job submission.
      if (
        error instanceof ApiError &&
        this.preparationFailures.has(error) &&
        [400, 403, 404, 409, 410, 503].includes(error.status)
      )
        return false;
      throw error;
    }
  }
}
