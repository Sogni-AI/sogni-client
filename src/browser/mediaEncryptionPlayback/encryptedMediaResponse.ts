/** Serves authenticated plaintext byte ranges without buffering a complete media file. */
export const ENCRYPTED_MEDIA_PATH = '/__sogni_encrypted_media/';
export const ENCRYPTED_MEDIA_CHUNK_BYTES = 1024 * 1024;

export interface MediaRangeReader {
  size: number;
  contentType: string;
  read(start: number, end: number): Promise<Uint8Array>;
  close(): void;
}

/** Browser media elements ask for single HTTP byte ranges when loading and seeking. */
export function encryptedMediaResponse(request: Request, reader: MediaRangeReader): Response {
  const headers = new Headers({
    'Content-Type': reader.contentType,
    'Cache-Control': 'no-store',
    'Accept-Ranges': 'bytes',
    'X-Content-Type-Options': 'nosniff'
  });
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    reader.close();
    return new Response(null, { status: 405, headers });
  }
  let start = 0;
  let end = reader.size;
  let status = 200;
  const range = request.headers.get('Range');
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    const first = match?.[1];
    const last = match?.[2];
    if (match && (first || last)) {
      if (!first) start = Math.max(0, reader.size - Number(last));
      else {
        start = Number(first);
        if (last) end = Math.min(reader.size, Number(last) + 1);
      }
    }
    if (
      !match ||
      (!first && !last) ||
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      start >= reader.size ||
      end <= start
    ) {
      reader.close();
      headers.set('Content-Range', `bytes */${reader.size}`);
      return new Response(null, { status: 416, headers });
    }
    status = 206;
    headers.set('Content-Range', `bytes ${start}-${end - 1}/${reader.size}`);
  }
  headers.set('Content-Length', String(end - start));
  if (request.method === 'HEAD') {
    reader.close();
    return new Response(null, { status, headers });
  }
  let position = start;
  const body = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        try {
          if (request.signal.aborted) throw new Error('Media request cancelled');
          const next = Math.min(end, position + ENCRYPTED_MEDIA_CHUNK_BYTES);
          const bytes = await reader.read(position, next);
          if (bytes.byteLength !== next - position) throw new Error('Incomplete media range');
          if (request.signal.aborted) throw new Error('Media request cancelled');
          position = next;
          controller.enqueue(bytes);
          if (position === end) {
            controller.close();
            reader.close();
          }
        } catch (error) {
          reader.close();
          controller.error(error);
        }
      },
      cancel() {
        reader.close();
      }
    },
    { highWaterMark: 0 }
  );
  return new Response(body, { status, headers });
}
