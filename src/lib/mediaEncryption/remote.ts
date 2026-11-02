import { aesGcmDecrypt, deriveFileKey } from './crypto.js';
import {
  MAX_HEADER_BYTES,
  MediaEncryptionError,
  MediaEncryptionHeader,
  TAG_BYTES,
  parseHeader,
  segmentNonce
} from './format.js';

/** A seekable decrypted view; plaintext is never stored by the reader. */
export interface DecryptedMediaReader {
  readonly contentType: string;
  readonly size: number;
  /** Read [start, end). Use stream for large ranges to avoid collecting them in memory. */
  read(start: number, end: number, signal?: AbortSignal): Promise<Uint8Array>;
  /** Authenticate one segment at a time, with consumer backpressure. */
  stream(start?: number, end?: number, signal?: AbortSignal): ReadableStream<Uint8Array>;
  /** Abort outstanding requests and make this reader unusable. */
  close(): void;
}

/** Read a response of known, bounded size without accepting an unbounded server body. */
async function boundedBody(response: Response, length: number): Promise<Uint8Array> {
  if (!response.body) throw new MediaEncryptionError('malformed', 'Media response has no body');
  const reader = response.body.getReader();
  const bytes = new Uint8Array(length);
  let offset = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.length > length - offset) {
        throw new MediaEncryptionError('malformed', 'Media response exceeds its byte range');
      }
      bytes.set(value, offset);
      offset += value.length;
    }
    if (offset !== length) {
      throw new MediaEncryptionError('malformed', 'Media byte range is truncated');
    }
    return bytes;
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** @internal HTTP byte ranges map to independently authenticated container segments. */
export async function openRemoteEncryptedMedia(
  url: string,
  resolveKey: (header: MediaEncryptionHeader) => Promise<Uint8Array>,
  options: { init?: RequestInit; assertCurrent?: () => void; onClose?: () => void } = {}
): Promise<DecryptedMediaReader> {
  const lifetime = new AbortController();
  let fileKey: CryptoKey | null = null;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    fileKey = null;
    lifetime.abort();
    options.init?.signal?.removeEventListener('abort', close);
    options.onClose?.();
  };
  const assertOpen = () => {
    if (closed || options.init?.signal?.aborted) {
      throw new DOMException('Encrypted media reader is closed', 'AbortError');
    }
    options.assertCurrent?.();
  };
  options.init?.signal?.addEventListener('abort', close, { once: true });

  const fetchRange = async (
    start: number,
    end: number,
    expectedTotal?: number,
    signal?: AbortSignal
  ) => {
    assertOpen();
    const request = new AbortController();
    const abort = () => request.abort();
    lifetime.signal.addEventListener('abort', abort, { once: true });
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    try {
      const headers = new Headers(options.init?.headers);
      headers.set('Range', `bytes=${start}-${end - 1}`);
      const response = await fetch(url, {
        ...options.init,
        method: 'GET',
        body: undefined,
        headers,
        cache: 'no-store',
        signal: request.signal
      });
      assertOpen();
      const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('Content-Range') ?? '');
      const encoding = response.headers.get('Content-Encoding');
      if (response.status !== 206 || !match || (encoding && encoding !== 'identity')) {
        await response.body?.cancel();
        throw new MediaEncryptionError(
          'unsupported',
          'Encrypted playback requires HTTP byte-range support'
        );
      }
      const [, first, last, complete] = match.map(Number);
      if (
        !Number.isSafeInteger(complete) ||
        complete <= 0 ||
        first !== start ||
        last !== Math.min(end, complete) - 1 ||
        (expectedTotal !== undefined && complete !== expectedTotal)
      ) {
        await response.body?.cancel();
        throw new MediaEncryptionError('malformed', 'Media response has an invalid byte range');
      }
      const bytes = await boundedBody(response, last - first + 1);
      assertOpen();
      if (request.signal.aborted) throw new DOMException('Media read aborted', 'AbortError');
      return { bytes, total: complete };
    } finally {
      lifetime.signal.removeEventListener('abort', abort);
      signal?.removeEventListener('abort', abort);
    }
  };

  try {
    const prefix = await fetchRange(0, MAX_HEADER_BYTES);
    const header = parseHeader(prefix.bytes);
    const segmentSize = 2 ** header.segmentSizeLog2;
    const sealedSegmentSize = segmentSize + TAG_BYTES;
    const bodyLength = prefix.total - header.bytes.length;
    const segmentCount = Math.ceil(bodyLength / sealedSegmentSize);
    const finalLength = bodyLength - (segmentCount - 1) * sealedSegmentSize;
    if (bodyLength < TAG_BYTES || finalLength < TAG_BYTES || segmentCount > 2 ** 32) {
      throw new MediaEncryptionError('malformed', 'Encrypted media has invalid segment framing');
    }
    const size = bodyLength - segmentCount * TAG_BYTES;
    const projectKey = new Uint8Array(await resolveKey(header));
    try {
      assertOpen();
      fileKey = await deriveFileKey(projectKey, header.bytes, header.salt);
    } finally {
      projectKey.fill(0);
    }
    assertOpen();
    const readSegment = async (index: number, signal?: AbortSignal) => {
      assertOpen();
      const start = header.bytes.length + index * sealedSegmentSize;
      const { bytes } = await fetchRange(
        start,
        Math.min(prefix.total, start + sealedSegmentSize),
        prefix.total,
        signal
      );
      assertOpen();
      const plaintext = await aesGcmDecrypt(
        fileKey!,
        segmentNonce(header.noncePrefix, index, index === segmentCount - 1),
        bytes
      );
      try {
        assertOpen();
        if (signal?.aborted) throw new DOMException('Media read aborted', 'AbortError');
      } catch (error) {
        plaintext.fill(0);
        throw error;
      }
      return plaintext;
    };
    // Authenticates MIME/header and the advertised file length before returning.
    // A truncated/appended object must not become a playable shorter/longer file.
    (await readSegment(0)).fill(0);
    if (segmentCount > 1) (await readSegment(segmentCount - 1)).fill(0);
    const validateRange = (start: number, end: number) => {
      assertOpen();
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start < 0 ||
        end < start ||
        end > size
      ) {
        throw new RangeError('Decrypted byte range is outside the media');
      }
    };
    const stream = (start = 0, end = size, signal?: AbortSignal) => {
      validateRange(start, end);
      const reading = new AbortController();
      let offset = start;
      const abort = () => reading.abort();
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      const release = () => signal?.removeEventListener('abort', abort);
      return new ReadableStream<Uint8Array>(
        {
          async pull(controller) {
            try {
              assertOpen();
              if (reading.signal.aborted)
                throw new DOMException('Media read aborted', 'AbortError');
              if (offset === end) {
                release();
                controller.close();
                return;
              }
              const index = Math.floor(offset / segmentSize);
              const plaintext = await readSegment(index, reading.signal);
              const from = offset % segmentSize;
              const count = Math.min(plaintext.length - from, end - offset);
              const chunk = plaintext.slice(from, from + count);
              plaintext.fill(0);
              offset += count;
              controller.enqueue(chunk);
            } catch (error) {
              release();
              controller.error(error);
            }
          },
          cancel() {
            reading.abort();
            release();
          }
        },
        { highWaterMark: 0 }
      );
    };
    return {
      size,
      contentType: header.contentType,
      stream,
      async read(start, end, signal) {
        validateRange(start, end);
        const result = new Uint8Array(end - start);
        const reader = stream(start, end, signal).getReader();
        let offset = 0;
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) return result;
            result.set(value, offset);
            offset += value.length;
            value.fill(0);
          }
        } catch (error) {
          result.fill(0);
          throw error;
        } finally {
          await reader.cancel().catch(() => undefined);
          reader.releaseLock();
        }
      },
      close
    };
  } catch (error) {
    close();
    throw error;
  }
}
