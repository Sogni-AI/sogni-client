import ApiGroup, { ApiConfig } from '../ApiGroup.js';
import { ApiError, ApiErrorResponse } from '../ApiClient/index.js';
import { getFileContentType } from '../Projects/utils/fileContentType.js';
import { fetchWithCredentials } from '../lib/fetchWithCredentials.js';
import getUUID from '../lib/getUUID.js';
import { captureRequestSession } from '../lib/requestSession.js';
import type {
  AudioSpeechCreateParams,
  AudioTranscriptionCreateParams,
  AudioTranscriptionFileInput,
  AudioTranscriptionJsonResult,
  AudioTranscriptionResult
} from './types.js';

const DEFAULT_AUDIO_HTTP_TIMEOUT_MS = 300_000;
const HTML_BODY_HEAD_RE = /^(?:\ufeff)?\s*<(?:!doctype\b|html[\s>])/i;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isHtmlBodyOrContentType(response: Response, rawText: string): boolean {
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  return contentType.includes('text/html') || HTML_BODY_HEAD_RE.test(rawText);
}

function toAbortError(signal?: AbortSignal): unknown {
  return signal?.reason ?? new DOMException('The request was aborted', 'AbortError');
}

async function readResponseTextWithAbort(response: Response, signal: AbortSignal): Promise<string> {
  if (signal.aborted) {
    void response.body?.cancel(signal.reason).catch(() => undefined);
    throw toAbortError(signal);
  }
  return await new Promise<string>((resolve, reject) => {
    const onAbort = () => {
      const reason = toAbortError(signal);
      void response.body?.cancel(reason).catch(() => undefined);
      reject(reason);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    response.text().then(
      (text) => {
        signal.removeEventListener('abort', onAbort);
        if (signal.aborted) {
          reject(toAbortError(signal));
          return;
        }
        resolve(text);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(signal.aborted ? (signal.reason ?? error) : error);
      }
    );
  });
}

function extensionForMimeType(mimeType: string | undefined): string {
  const normalized = mimeType?.split(';')[0]?.trim().toLowerCase();
  switch (normalized) {
    case 'audio/wav':
    case 'audio/wave':
    case 'audio/x-wav':
      return 'wav';
    case 'audio/flac':
    case 'audio/x-flac':
      return 'flac';
    case 'audio/ogg':
      return 'ogg';
    case 'audio/opus':
      return 'opus';
    case 'audio/webm':
      return 'webm';
    case 'audio/mp4':
    case 'audio/m4a':
    case 'audio/x-m4a':
      return 'm4a';
    case 'video/mp4':
      return 'mp4';
    case 'video/quicktime':
      return 'mov';
    case 'video/webm':
      return 'webm';
    case 'audio/mpeg':
    case 'audio/mp3':
    default:
      return 'mp3';
  }
}

function toUploadBlobAndFilename(
  file: AudioTranscriptionFileInput,
  filenameHint?: string,
  mimeTypeHint?: string
): { blob: Blob; filename: string } {
  if (typeof File !== 'undefined' && file instanceof File) {
    const mimeType = mimeTypeHint || file.type || 'application/octet-stream';
    const filename = filenameHint || file.name || `audio.${extensionForMimeType(mimeType)}`;
    const blob =
      mimeTypeHint && mimeTypeHint !== file.type ? new Blob([file], { type: mimeType }) : file;
    return { blob, filename };
  }

  if (file instanceof Blob) {
    const mimeType = mimeTypeHint || file.type || 'application/octet-stream';
    const filename = filenameHint || `audio.${extensionForMimeType(mimeType)}`;
    const blob = mimeType !== file.type ? new Blob([file], { type: mimeType }) : file;
    return { blob, filename };
  }

  let bytes: Uint8Array;
  let sniffedMime: string | undefined;
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(file)) {
    sniffedMime = getFileContentType(file, 'audio');
    bytes = new Uint8Array(file.buffer, file.byteOffset, file.byteLength);
  } else if (file instanceof Uint8Array) {
    if (typeof Buffer !== 'undefined') {
      sniffedMime = getFileContentType(
        Buffer.from(file.buffer, file.byteOffset, file.byteLength),
        'audio'
      );
    }
    bytes = file;
  } else if (file instanceof ArrayBuffer) {
    const view = new Uint8Array(file);
    if (typeof Buffer !== 'undefined') {
      sniffedMime = getFileContentType(Buffer.from(view), 'audio');
    }
    bytes = view;
  } else {
    throw new Error('file must be a File, Blob, Buffer, Uint8Array, or ArrayBuffer.');
  }

  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const mimeType = mimeTypeHint || sniffedMime || 'application/octet-stream';
  const filename = filenameHint || `audio.${extensionForMimeType(mimeType)}`;
  return {
    blob: new Blob([copy], { type: mimeType }),
    filename
  };
}

async function throwAudioHttpError(response: Response, signal?: AbortSignal): Promise<never> {
  const rawText = signal
    ? await readResponseTextWithAbort(response, signal)
    : await response.text();
  let parsedValue: unknown;
  try {
    parsedValue = rawText ? JSON.parse(rawText) : undefined;
  } catch {
    parsedValue = undefined;
  }
  const parsedObj = isPlainObject(parsedValue) ? parsedValue : undefined;
  const nestedError = isPlainObject(parsedObj?.error) ? parsedObj.error : undefined;
  const fallbackStatusMessage = response.statusText
    ? `Audio API request failed (${response.status} ${response.statusText})`
    : `Audio API request failed with status ${response.status}`;
  const sanitizedRawMessage = isHtmlBodyOrContentType(response, rawText)
    ? fallbackStatusMessage
    : rawText.trim().slice(0, 512);
  const message =
    (typeof parsedObj?.message === 'string' && parsedObj.message.trim()) ||
    (typeof nestedError?.message === 'string' && nestedError.message.trim()) ||
    (typeof parsedObj?.error === 'string' && parsedObj.error.trim()) ||
    (typeof parsedValue === 'string' && parsedValue.trim()) ||
    sanitizedRawMessage ||
    fallbackStatusMessage;
  const errorCode =
    typeof parsedObj?.errorCode === 'number'
      ? parsedObj.errorCode
      : typeof nestedError?.errorCode === 'number'
        ? nestedError.errorCode
        : response.status;
  const errorPayload: ApiErrorResponse = {
    ...(parsedObj || {}),
    status: 'error',
    errorCode,
    message
  };
  throw new ApiError(response.status, errorPayload, response.headers.get('retry-after'));
}

interface AudioFetchHandle {
  response: Response;
  controller: AbortController;
  assertSession: () => void;
  cleanup: () => void;
}

function wrapSpeechStreamResponse(handle: AudioFetchHandle): Response {
  const { response, controller, assertSession, cleanup } = handle;
  const sourceBody = response.body;
  if (!sourceBody) {
    cleanup();
    assertSession();
    return response;
  }
  if (controller.signal.aborted) {
    cleanup();
    void sourceBody.cancel(controller.signal.reason).catch(() => undefined);
    throw toAbortError(controller.signal);
  }

  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let streamCtrl: ReadableStreamDefaultController<Uint8Array> | undefined;
  let finished = false;

  const finalize = () => {
    if (finished) return;
    finished = true;
    controller.signal.removeEventListener('abort', onAbort);
    cleanup();
  };

  const onAbort = () => {
    const reason = toAbortError(controller.signal);
    finalize();
    if (reader) {
      void reader.cancel(reason).catch(() => undefined);
    } else {
      void sourceBody.cancel(reason).catch(() => undefined);
    }
    try {
      streamCtrl?.error(reason);
    } catch {
      // Stream already closed or errored.
    }
  };

  controller.signal.addEventListener('abort', onAbort, { once: true });

  const wrappedBody = new ReadableStream<Uint8Array>({
    start(c) {
      streamCtrl = c;
      if (controller.signal.aborted) {
        onAbort();
      }
    },
    async pull(c) {
      if (controller.signal.aborted) {
        onAbort();
        return;
      }
      if (!reader) {
        reader = sourceBody.getReader();
      }
      try {
        const chunk = await reader.read();
        if (controller.signal.aborted) {
          onAbort();
          return;
        }
        assertSession();
        if (chunk.done) {
          finalize();
          c.close();
          return;
        }
        c.enqueue(chunk.value);
      } catch (error) {
        const reason = controller.signal.aborted ? toAbortError(controller.signal) : error;
        finalize();
        c.error(reason);
      }
    },
    async cancel(reason) {
      finalize();
      if (reader) {
        await reader.cancel(reason).catch(() => undefined);
      } else {
        await sourceBody.cancel(reason).catch(() => undefined);
      }
    }
  });

  return new Response(wrappedBody, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  });
}

/**
 * OpenAI-compatible REST audio client (`sogni.audio.speech` and `sogni.audio.transcriptions`).
 *
 * Works over HTTP on both standard and REST-only (`disableSocket: true`) `SogniClient` instances.
 */
class AudioApi extends ApiGroup {
  speech: {
    /**
     * Synthesize spoken audio from text (`POST /v1/audio/speech`).
     * Returns a `Response` carrying the binary audio stream (`await res.arrayBuffer()`, `await res.blob()`).
     */
    create: (params: AudioSpeechCreateParams) => Promise<Response>;
  };

  transcriptions: {
    /**
     * Transcribe an audio or video file (`POST /v1/audio/transcriptions`).
     */
    create: ((
      params: AudioTranscriptionCreateParams & { response_format: 'text' | 'srt' | 'vtt' }
    ) => Promise<string>) &
      ((
        params: AudioTranscriptionCreateParams & { responseFormat: 'text' | 'srt' | 'vtt' }
      ) => Promise<string>) &
      ((params: AudioTranscriptionCreateParams) => Promise<AudioTranscriptionJsonResult>);
  };

  constructor(config: ApiConfig) {
    super(config);
    this.speech = {
      create: this.createSpeech.bind(this)
    };
    this.transcriptions = {
      create: this.createTranscription.bind(this) as AudioApi['transcriptions']['create']
    };
  }

  private async audioFetch(
    path: string,
    options: RequestInit,
    callerSignal?: AbortSignal,
    timeoutMs = DEFAULT_AUDIO_HTTP_TIMEOUT_MS
  ): Promise<AudioFetchHandle> {
    if (callerSignal?.aborted) {
      throw toAbortError(callerSignal);
    }

    const assertSession = captureRequestSession(this.client.auth);
    const url = new URL(path, this.client.rest.baseUrl).toString();
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(new DOMException('Audio API request timed out', 'TimeoutError')),
      timeoutMs
    );
    (timeoutId as { unref?: () => void }).unref?.();

    const cancelChangedSession = () => {
      try {
        assertSession();
      } catch (error) {
        controller.abort(error);
      }
    };
    const cancelRequested = () => controller.abort(toAbortError(callerSignal));
    const offAuth = this.client.auth?.on('updated', cancelChangedSession);
    const offSession = this.client.auth?.on('sessionChanged', cancelChangedSession);
    if (callerSignal?.aborted) cancelRequested();
    else callerSignal?.addEventListener('abort', cancelRequested, { once: true });

    let cleanedUp = false;
    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      clearTimeout(timeoutId);
      offAuth?.();
      offSession?.();
      callerSignal?.removeEventListener('abort', cancelRequested);
    };

    try {
      if (controller.signal.aborted) {
        throw toAbortError(controller.signal);
      }
      const authenticated = await this.client.auth.authenticateRequest(options);
      if (controller.signal.aborted) {
        throw toAbortError(controller.signal);
      }
      assertSession();
      const response = await fetchWithCredentials(url, {
        ...authenticated,
        signal: controller.signal
      });
      if (response.status === 401 && this.client.auth.isAuthenticated) {
        this.client.auth.clear();
        if (this.client.auth.isAuthenticated) assertSession();
      }
      try {
        assertSession();
      } catch (error) {
        void response.body?.cancel().catch(() => undefined);
        throw error;
      }
      return { response, controller, assertSession, cleanup };
    } catch (error) {
      cleanup();
      throw error;
    }
  }

  private async createSpeech(params: AudioSpeechCreateParams): Promise<Response> {
    if (!params || typeof params.input !== 'string' || !params.input.trim()) {
      throw new Error('audio.speech.create requires a non-empty string input.');
    }

    const responseFormat = params.response_format ?? params.responseFormat;
    const referenceAudio = params.reference_audio ?? params.referenceAudio;
    const referenceText = params.reference_text ?? params.referenceText;
    const hasReferenceAudio =
      typeof referenceAudio === 'string'
        ? referenceAudio.trim().length > 0
        : referenceAudio !== undefined && referenceAudio !== null;
    const model = params.model?.trim() || (hasReferenceAudio ? 'clone' : 'voice');
    const lowerModel = model.toLowerCase();
    const isDrama3 =
      lowerModel === 'drama3' ||
      lowerModel === 'fish_drama_3_nvfp4' ||
      lowerModel === 'fish-drama-3';
    const tokenType = params.token_type ?? params.tokenType;
    const billingMode = params.billing_mode ?? params.billingMode;
    const appSource = params.app_source ?? params.appSource ?? this.client.appSource;
    const headers = {
      'Content-Type': 'application/json',
      ...this.attributionHeaders(appSource, params.attribution, getUUID())
    };

    const body: Record<string, unknown> = {
      model,
      input: params.input,
      ...(params.voice !== undefined ? { voice: params.voice } : {}),
      ...(responseFormat !== undefined ? { response_format: responseFormat } : {}),
      ...(params.instructions !== undefined ? { instructions: params.instructions } : {}),
      ...(params.language !== undefined ? { language: params.language } : {}),
      ...(referenceAudio !== undefined ? { reference_audio: referenceAudio } : {}),
      ...(referenceText !== undefined ? { reference_text: referenceText } : {}),
      ...(params.seed !== undefined ? { seed: params.seed } : {}),
      ...(!isDrama3 && params.creativity !== undefined ? { creativity: params.creativity } : {}),
      ...(tokenType !== undefined ? { token_type: tokenType } : {}),
      ...(billingMode !== undefined ? { billing_mode: billingMode } : {}),
      ...(appSource !== undefined ? { app_source: appSource } : {})
    };

    const handle = await this.audioFetch(
      '/v1/audio/speech',
      {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
      },
      params.signal
    );

    if (!handle.response.ok) {
      try {
        await throwAudioHttpError(handle.response, handle.controller.signal);
      } finally {
        handle.cleanup();
      }
    }

    return wrapSpeechStreamResponse(handle);
  }

  private async createTranscription(
    params: AudioTranscriptionCreateParams
  ): Promise<AudioTranscriptionResult> {
    if (!params || !params.file) {
      throw new Error('audio.transcriptions.create requires a file.');
    }

    const { blob, filename } = toUploadBlobAndFilename(
      params.file,
      params.filename,
      params.mimeType
    );
    const model =
      params.model?.trim() ||
      (params.diarize || params.hotwords?.trim() || params.prompt?.trim()
        ? 'nemotron'
        : 'parakeet');
    const responseFormat = params.response_format ?? params.responseFormat;
    const granularities = params.timestamp_granularities ?? params.timestampGranularities;
    const tokenType = params.token_type ?? params.tokenType;
    const billingMode = params.billing_mode ?? params.billingMode;
    const appSource = params.app_source ?? params.appSource ?? this.client.appSource;

    const formData = new FormData();
    formData.append('file', blob, filename);
    formData.append('model', model);
    if (params.language !== undefined) formData.append('language', params.language);
    if (params.prompt !== undefined) formData.append('prompt', params.prompt);
    if (responseFormat !== undefined) formData.append('response_format', responseFormat);
    if (Array.isArray(granularities)) {
      for (const granularity of granularities) {
        formData.append('timestamp_granularities[]', granularity);
      }
    }
    if (params.diarize !== undefined) formData.append('diarize', String(params.diarize));
    if (params.hotwords !== undefined) formData.append('hotwords', params.hotwords);
    if (tokenType !== undefined) formData.append('token_type', tokenType);
    if (billingMode !== undefined) formData.append('billing_mode', billingMode);
    if (appSource !== undefined) formData.append('app_source', appSource);

    const headers = this.attributionHeaders(appSource, params.attribution, getUUID());
    const handle = await this.audioFetch(
      '/v1/audio/transcriptions',
      {
        method: 'POST',
        headers,
        body: formData
      },
      params.signal
    );

    try {
      const { response, controller, assertSession } = handle;
      if (!response.ok) {
        await throwAudioHttpError(response, controller.signal);
      }

      const wantsTextFormat =
        responseFormat === 'text' || responseFormat === 'srt' || responseFormat === 'vtt';

      if (wantsTextFormat) {
        const text = await readResponseTextWithAbort(response, controller.signal);
        assertSession();
        return text;
      }

      const rawText = await readResponseTextWithAbort(response, controller.signal);
      assertSession();

      let parsedValue: unknown;
      try {
        parsedValue = rawText ? JSON.parse(rawText) : undefined;
      } catch {
        parsedValue = undefined;
      }

      if (!isPlainObject(parsedValue)) {
        const unexpectedHtml = isHtmlBodyOrContentType(response, rawText);
        const message = unexpectedHtml
          ? `Audio transcription API returned unexpected HTML response (status ${response.status}).`
          : `Audio transcription API returned an invalid JSON object response (status ${response.status}).`;
        throw new ApiError(
          response.status,
          {
            status: 'error',
            errorCode: response.status,
            message
          },
          response.headers.get('retry-after')
        );
      }

      if (
        !('text' in parsedValue) &&
        isPlainObject(parsedValue.data) &&
        'text' in parsedValue.data
      ) {
        return parsedValue.data as unknown as AudioTranscriptionJsonResult;
      }
      return parsedValue as unknown as AudioTranscriptionJsonResult;
    } finally {
      handle.cleanup();
    }
  }
}

export default AudioApi;
