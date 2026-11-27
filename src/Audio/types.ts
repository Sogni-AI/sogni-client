import type { BillingMode } from '../Projects/types/index.js';
import type { WorkloadAttributionInput } from '../types/attribution.js';
import type { TokenType } from '../types/token.js';

export type AudioSpeechModelSelector =
  | 'voice'
  | 'clone'
  | 'design'
  | 'drama3'
  | 'tts-1'
  | 'tts-1-hd'
  | 'gpt-4o-mini-tts'
  | (string & {});

export type AudioSpeechResponseFormat = 'mp3' | 'wav' | 'flac';

export interface AudioSpeechCreateParams {
  /**
   * Speech model selector or canonical model ID. Defaults to `'clone'` when
   * `reference_audio` / `referenceAudio` is provided, otherwise `'voice'`.
   * - `'voice'` / `'clone'` / `'design'`: Qwen3-TTS 1.7B modes.
   * - `'drama3'`: Fish Drama 3 expressive acting speech (`[sighs]`, `[laughs]`, `<whisper>...</whisper>`).
   * - OpenAI aliases `'tts-1'`, `'tts-1-hd'`, `'gpt-4o-mini-tts'` are also accepted.
   */
  model?: AudioSpeechModelSelector;
  /** The literal script text to synthesize into spoken audio. */
  input: string;
  /** Preset studio voice (for `'voice'` mode or OpenAI voice aliases). */
  voice?: string;
  /** Output audio container format (`'mp3'`, `'wav'`, or `'flac'`). */
  response_format?: AudioSpeechResponseFormat;
  /** CamelCase alias for `response_format`. */
  responseFormat?: AudioSpeechResponseFormat;
  /** Delivery direction for `'voice'` or speaker description to invent for `'design'`. */
  instructions?: string;
  /** Script language or `'auto'`. */
  language?: string;
  /** Reference audio HTTPS URL or inline audio data URI for `'clone'` or optional `'drama3'` cloning. */
  reference_audio?: string;
  /** CamelCase alias for `reference_audio`. */
  referenceAudio?: string;
  /** Verbatim transcript of `reference_audio` (up to 1024 chars on `'clone'`, 2000 chars on `'drama3'`). */
  reference_text?: string;
  /** CamelCase alias for `reference_text`. */
  referenceText?: string;
  /** Optional integer seed for reproducible speech takes. */
  seed?: number;
  /** Qwen3-TTS (`voice`, `clone`, `design`) variation from 0.1 to 2. Omit on `'drama3'`. */
  creativity?: number;
  /** Token type for billing (`'sogni'` or `'spark'`). */
  token_type?: TokenType;
  /** CamelCase alias for `token_type`. */
  tokenType?: TokenType;
  /** Billing mode (`'auto'`, `'subscription'`, or `'tokens'`). */
  billing_mode?: BillingMode;
  /** CamelCase alias for `billing_mode`. */
  billingMode?: BillingMode;
  /** Optional client app/source label. */
  app_source?: string;
  /** CamelCase alias for `app_source`. */
  appSource?: string;
  /** Optional per-request workload attribution override. */
  attribution?: WorkloadAttributionInput;
  /** Optional AbortSignal to cancel the HTTP request. */
  signal?: AbortSignal;
}

export type AudioTranscriptionModelSelector =
  | 'parakeet'
  | 'nemotron'
  | 'whisper-1'
  | 'gpt-4o-transcribe'
  | 'gpt-4o-mini-transcribe'
  | 'gpt-4o-transcribe-diarize'
  | (string & {});

export type AudioTranscriptionResponseFormat = 'json' | 'verbose_json' | 'text' | 'srt' | 'vtt';

export type AudioTranscriptionTimestampGranularity = 'word' | 'segment' | 'sentence';

export type AudioTranscriptionFileInput = File | Blob | Buffer | Uint8Array | ArrayBuffer;

export interface AudioTranscriptionCreateParams {
  /** Audio or video file to transcribe (`File`, `Blob`, `Buffer`, `Uint8Array`, or `ArrayBuffer`). */
  file: AudioTranscriptionFileInput;
  /** Optional filename hint when `file` is a `Blob`, `Buffer`, `Uint8Array`, or `ArrayBuffer`. */
  filename?: string;
  /** Optional MIME type override when `file` is raw bytes without a declared type. */
  mimeType?: string;
  /**
   * Transcription engine selector or canonical model ID.
   * - `'parakeet'` (default): fast 25-language European STT up to 2 hours.
   * - `'nemotron'`: 40-language NVIDIA Nemotron 3.5 30B STT up to 1 hour with speaker diarization and hotwords.
   * - OpenAI aliases `'whisper-1'`, `'gpt-4o-transcribe'`, `'gpt-4o-mini-transcribe'`, `'gpt-4o-transcribe-diarize'` are accepted.
   */
  model?: AudioTranscriptionModelSelector;
  /** Optional ISO / spoken language hint. */
  language?: string;
  /** Optional context or vocabulary hint for `'nemotron'` (max 2000 chars). */
  prompt?: string;
  /** Output format (`'json'`, `'verbose_json'`, `'text'`, `'srt'`, or `'vtt'`). Defaults to `'json'`. */
  response_format?: AudioTranscriptionResponseFormat;
  /** CamelCase alias for `response_format`. */
  responseFormat?: AudioTranscriptionResponseFormat;
  /** OpenAI-compatible timestamp granularities (`'segment'` / `'sentence'` and/or `'word'`). */
  timestamp_granularities?: AudioTranscriptionTimestampGranularity[];
  /** CamelCase alias for `timestamp_granularities`. */
  timestampGranularities?: AudioTranscriptionTimestampGranularity[];
  /** Enable multi-speaker diarization labels (`S01`, `S02`, ...; supported by `'nemotron'`). */
  diarize?: boolean;
  /** Comma-separated names, brands, or technical vocabulary terms for `'nemotron'` (max 1000 chars). */
  hotwords?: string;
  /** Token type for billing (`'sogni'` or `'spark'`). */
  token_type?: TokenType;
  /** CamelCase alias for `token_type`. */
  tokenType?: TokenType;
  /** Billing mode (`'auto'`, `'subscription'`, or `'tokens'`). */
  billing_mode?: BillingMode;
  /** CamelCase alias for `billing_mode`. */
  billingMode?: BillingMode;
  /** Optional client app/source label. */
  app_source?: string;
  /** CamelCase alias for `app_source`. */
  appSource?: string;
  /** Optional per-request workload attribution override. */
  attribution?: WorkloadAttributionInput;
  /** Optional AbortSignal to cancel the HTTP request. */
  signal?: AbortSignal;
}

export interface AudioTranscriptionSegment {
  id: number;
  start: number;
  end: number;
  text: string;
  speaker?: string;
}

export interface AudioTranscriptionWord {
  word: string;
  start: number;
  end: number;
  speaker?: string;
}

export interface AudioTranscriptionJsonResult {
  task?: 'transcribe';
  text: string;
  rawText?: string;
  model?: string;
  duration?: number;
  language?: string;
  diarized?: boolean;
  timestampGranularity?: 'none' | 'sentence' | 'word';
  segments?: AudioTranscriptionSegment[];
  words?: AudioTranscriptionWord[];
  complete?: boolean;
  finishReason?: string;
}

export type AudioTranscriptionResult = AudioTranscriptionJsonResult | string;
