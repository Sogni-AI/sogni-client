/**
 * Helpers for rebuilding local project state from the server's recovery
 * payloads (`authenticated.activeProjects` / `unclaimedCompletedProjects` and
 * `GET /api/v1/artist/projects/sync`). See docs/artist-project-recovery.md in
 * sogni-socket for the wire contract.
 */
import type {
  RecoveredProject,
  RecoveredWorkerJob,
  RecoveredWorkerJobStatus
} from '../ApiClient/WebSocketClient/events.js';
import type { ProjectParams } from './types/index.js';
import type ErrorData from '../types/ErrorData.js';

/**
 * `originalCode` of the error the SDK assigns when a remembered project is
 * gone from the server and the REST API has no record of it.
 */
export const PROJECT_LOST_ORIGINAL_CODE = 'projectLost';

export const PROJECT_LOST_ERROR: ErrorData = Object.freeze({
  code: 0,
  originalCode: PROJECT_LOST_ORIGINAL_CODE,
  message:
    'The server has no record of this generation. It may have been interrupted by a restart — please try again.'
});

/** `true` for the failure the SDK assigns when a project could not be found on the server. */
export function isProjectLostError(error: ErrorData | undefined | null): boolean {
  return error?.originalCode === PROJECT_LOST_ORIGINAL_CODE;
}

/** Decode the base64 JSON `clientRequestData` blob; `null` when absent or malformed. */
export function decodeClientRequestData(encoded?: string | null): Record<string, any> | null {
  if (!encoded || typeof encoded !== 'string') return null;
  try {
    let json: string;
    if (typeof atob === 'function') {
      const binary = atob(encoded);
      const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
      json = new TextDecoder().decode(bytes);
    } else {
      json = Buffer.from(encoded, 'base64').toString('utf8');
    }
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/** LLM requests share the socket's project registry but are not media projects. */
export function isLLMRecoveredProject(project: RecoveredProject): boolean {
  return project.jobType === 'llm' || project.model?.type === 'llm';
}

export function mediaTypeFromRecoveredProject(
  project: RecoveredProject
): 'image' | 'video' | 'audio' {
  const type = project.modelType || project.model?.type;
  if (type === 'video') return 'video';
  if (type === 'audio' || type === 'music') return 'audio';
  return 'image';
}

const RAW_JOB_FINISHED: ReadonlySet<RecoveredWorkerJobStatus> = new Set([
  'jobCompleted',
  'jobError'
]);

export function isRecoveredJobFinished(status: RecoveredWorkerJobStatus | string): boolean {
  return RAW_JOB_FINISHED.has(status as RecoveredWorkerJobStatus);
}

/**
 * Best-effort reconstruction of the {@link ProjectParams} a project was created
 * with, from the server's copy of the original request. Enough for the SDK to
 * route events, mint result URLs, gate NSFW handling and report the prompt;
 * asset inputs (starting images, reference media) are not recoverable and are
 * left out.
 */
export function projectParamsFromRecoveredProject(project: RecoveredProject): ProjectParams {
  const request = decodeClientRequestData(project.clientRequestData) || {};
  const keyFrame = (
    Array.isArray(request.keyFrames) &&
    request.keyFrames[0] &&
    typeof request.keyFrames[0] === 'object'
      ? request.keyFrames[0]
      : {}
  ) as Record<string, any>;
  const type = mediaTypeFromRecoveredProject(project);
  const numberOfMedia =
    (typeof project.imageCount === 'number' && project.imageCount > 0
      ? project.imageCount
      : Number(request.numberOfImages)) || 1;

  const base: Record<string, unknown> = {
    type,
    modelId: keyFrame.modelID || project.model?.id || '',
    numberOfMedia,
    positivePrompt: typeof keyFrame.positivePrompt === 'string' ? keyFrame.positivePrompt : ''
  };
  if (typeof keyFrame.negativePrompt === 'string' && keyFrame.negativePrompt) {
    base.negativePrompt = keyFrame.negativePrompt;
  }
  if (typeof keyFrame.stylePrompt === 'string' && keyFrame.stylePrompt) {
    base.stylePrompt = keyFrame.stylePrompt;
  }
  const steps = typeof project.stepCount === 'number' ? project.stepCount : keyFrame.steps;
  if (typeof steps === 'number' && steps > 0) base.steps = steps;
  if (typeof keyFrame.guidanceScale === 'number') base.guidance = keyFrame.guidanceScale;
  if (typeof keyFrame.seed === 'number') base.seed = keyFrame.seed;
  if (Array.isArray(keyFrame.loras) && keyFrame.loras.length) base.loras = keyFrame.loras;
  if (Array.isArray(keyFrame.loraStrengths) && keyFrame.loraStrengths.length) {
    base.loraStrengths = keyFrame.loraStrengths;
  }
  const network = project.network || request.network;
  if (network === 'fast' || network === 'relaxed') base.network = network;
  const tokenType = project.tokenType || request.tokenType;
  if (tokenType) base.tokenType = tokenType;
  const billingMode = project.billingMode || request.billingMode;
  if (billingMode) base.billingMode = billingMode;
  if (request.disableSafety === true) base.disableNSFWFilter = true;
  if (typeof request.outputFormat === 'string' && request.outputFormat) {
    base.outputFormat = request.outputFormat;
  }
  if (project.appSource || request.appSource)
    base.appSource = project.appSource || request.appSource;

  if (type === 'image') {
    const previews =
      typeof project.previewCount === 'number' ? project.previewCount : Number(request.previews);
    if (Number.isFinite(previews) && previews > 0) base.numberOfPreviews = previews;
    if (project.sizePreset && project.sizePreset !== 'custom') base.sizePreset = project.sizePreset;
    if (typeof project.width === 'number') base.width = project.width;
    if (typeof project.height === 'number') base.height = project.height;
  } else if (type === 'video') {
    if (typeof project.width === 'number') base.width = project.width;
    if (typeof project.height === 'number') base.height = project.height;
    if (typeof keyFrame.frames === 'number') base.frames = keyFrame.frames;
    if (typeof keyFrame.fps === 'number') base.fps = keyFrame.fps;
    if (typeof keyFrame.duration === 'number') base.duration = keyFrame.duration;
  } else if (typeof keyFrame.duration === 'number') {
    base.duration = keyFrame.duration;
  }

  return base as unknown as ProjectParams;
}
