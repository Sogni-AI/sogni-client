/** Routes a media element's range request only to the tab that owns its decryption key. */
import { ENCRYPTED_MEDIA_PATH, encryptedMediaResponse } from './encryptedMediaResponse.js';

interface PlaybackClient {
  postMessage(message: unknown, transfer: Transferable[]): void;
}

interface BridgeReply {
  type?: string;
  size?: number;
  contentType?: string;
  bytes?: ArrayBuffer;
}

export async function serveEncryptedMedia(
  request: Request,
  requestingClientId: string,
  getClient: (id: string) => Promise<PlaybackClient | undefined>
): Promise<Response> {
  if (request.signal.aborted) {
    return new Response(null, { status: 410, headers: { 'Cache-Control': 'no-store' } });
  }
  const path = new URL(request.url).pathname.slice(ENCRYPTED_MEDIA_PATH.length);
  const [encodedOwner, token, extra] = path.split('/');
  let owner: string;
  try {
    owner = decodeURIComponent(encodedOwner);
  } catch {
    owner = '';
  }
  // A copied URL in another tab cannot use the original tab's media key.
  if (!owner || owner !== requestingClientId || !token || extra !== undefined) {
    return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }
  const client = await getClient(owner);
  if (!client) return new Response(null, { status: 410, headers: { 'Cache-Control': 'no-store' } });
  const channel = new MessageChannel();
  let pending: { resolve(data: BridgeReply): void; reject(error: Error): void } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    pending?.reject(new Error('Encrypted media was released'));
    pending = undefined;
    channel.port1.postMessage({ type: 'close' });
    channel.port1.close();
    request.signal.removeEventListener('abort', close);
  };
  const wait = () =>
    new Promise<BridgeReply>((resolve, reject) => {
      if (closed) return reject(new Error('Encrypted media was released'));
      pending = { resolve, reject };
      timer = setTimeout(() => {
        pending?.reject(new Error('Encrypted media could not be read'));
        pending = undefined;
        close();
      }, 30000);
    });
  channel.port1.onmessage = ({ data }) => {
    clearTimeout(timer);
    const current = pending;
    pending = undefined;
    if (data?.type === 'error') {
      current?.reject(new Error('Encrypted media could not be read'));
      close();
    } else current?.resolve(data);
  };
  request.signal.addEventListener('abort', close, { once: true });
  if (request.signal.aborted) close();
  try {
    const opening = wait();
    client.postMessage({ type: 'SOGNI_ENCRYPTED_MEDIA_REQUEST', token }, [channel.port2]);
    const metadata = await opening;
    if (
      metadata?.type !== 'metadata' ||
      typeof metadata.size !== 'number' ||
      !Number.isSafeInteger(metadata.size) ||
      metadata.size <= 0 ||
      typeof metadata.contentType !== 'string' ||
      !/^(video|audio)\/[a-zA-Z0-9.+-]+$/.test(metadata.contentType)
    )
      throw new Error('Invalid encrypted media metadata');
    return encryptedMediaResponse(request, {
      size: metadata.size,
      contentType: metadata.contentType,
      async read(start, end) {
        const received = wait();
        channel.port1.postMessage({ type: 'read', start, end });
        const data = await received;
        if (data?.type !== 'data' || !(data.bytes instanceof ArrayBuffer)) {
          throw new Error('Invalid encrypted media range');
        }
        return new Uint8Array(data.bytes);
      },
      close
    });
  } catch {
    close();
    return new Response(null, { status: 410, headers: { 'Cache-Control': 'no-store' } });
  }
}
