/** Makes seekable media URLs backed by authenticated SDK range reads in the owning tab. */
import { ENCRYPTED_MEDIA_CHUNK_BYTES, ENCRYPTED_MEDIA_PATH } from './encryptedMediaResponse.js';

export interface EncryptedPlaybackSource {
  contentType: string;
  size: number;
  read(start: number, end: number, signal?: AbortSignal): Promise<Uint8Array>;
  close(): void;
}

export type EncryptedPlaybackOpener = (url: string) => Promise<EncryptedPlaybackSource>;

interface PlaybackSession {
  source: EncryptedPlaybackSource;
  ports: Map<MessagePort, AbortController>;
}

const sessions = new Map<string, PlaybackSession>();
let listeningOn: ServiceWorkerContainer | undefined;

function receiveRequest(event: MessageEvent) {
  if (
    event.source !== navigator.serviceWorker.controller ||
    event.data?.type !== 'SOGNI_ENCRYPTED_MEDIA_REQUEST'
  )
    return;
  const port = event.ports[0];
  if (!port) return;
  const session = sessions.get(event.data.token);
  if (!session) {
    port.postMessage({ type: 'error' });
    port.close();
    return;
  }
  const abort = new AbortController();
  session.ports.set(port, abort);
  let reading = false;
  const close = () => {
    abort.abort();
    session.ports.delete(port);
    port.close();
  };
  port.onmessage = async ({ data }) => {
    if (data?.type === 'close') return close();
    const { start, end } = data ?? {};
    if (
      data?.type !== 'read' ||
      reading ||
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end <= start ||
      end > session.source.size ||
      end - start > ENCRYPTED_MEDIA_CHUNK_BYTES
    ) {
      port.postMessage({ type: 'error' });
      close();
      return;
    }
    reading = true;
    try {
      const bytes = await session.source.read(start, end, abort.signal);
      if (abort.signal.aborted || sessions.get(event.data.token) !== session) {
        bytes.fill(0);
        return;
      }
      // Transfer only this range, never another view's backing buffer.
      const buffer = new Uint8Array(bytes).buffer;
      bytes.fill(0);
      port.postMessage({ type: 'data', bytes: buffer }, [buffer]);
    } catch {
      if (!abort.signal.aborted) port.postMessage({ type: 'error' });
      close();
    } finally {
      reading = false;
    }
  };
  port.postMessage({
    type: 'metadata',
    size: session.source.size,
    contentType: session.source.contentType
  });
}

async function controllingWorker(): Promise<ServiceWorker> {
  if (!('serviceWorker' in navigator))
    throw new Error('Encrypted playback is unavailable in this browser');
  if (navigator.serviceWorker.controller) return navigator.serviceWorker.controller;
  return new Promise((resolve, reject) => {
    const changed = () => {
      const controller = navigator.serviceWorker.controller;
      if (!controller) return;
      clearTimeout(timer);
      navigator.serviceWorker.removeEventListener('controllerchange', changed);
      resolve(controller);
    };
    const timer = setTimeout(() => {
      navigator.serviceWorker.removeEventListener('controllerchange', changed);
      reject(new Error('Reload this page to open encrypted video or audio'));
    }, 8000);
    navigator.serviceWorker.addEventListener('controllerchange', changed);
  });
}

async function ownerClientId(worker: ServiceWorker): Promise<string> {
  const channel = new MessageChannel();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      channel.port1.close();
      reject(new Error('Reload this page to open encrypted video or audio'));
    }, 8000);
    channel.port1.onmessage = ({ data }) => {
      clearTimeout(timer);
      channel.port1.close();
      if (typeof data?.clientId === 'string' && data.clientId) resolve(data.clientId);
      else reject(new Error('Encrypted playback could not be opened'));
    };
    worker.postMessage({ type: 'SOGNI_ENCRYPTED_MEDIA_CLIENT' }, [channel.port2]);
  });
}

/** No key, plaintext, signed storage URL or registration is persisted in the service worker. */
export async function createEncryptedPlayback(source: EncryptedPlaybackSource): Promise<{
  url: string;
  dispose(): void;
}> {
  if (
    !Number.isSafeInteger(source.size) ||
    source.size <= 0 ||
    !/^(video|audio)\//.test(source.contentType)
  ) {
    source.close();
    throw new Error('Encrypted media has an invalid playback format');
  }
  try {
    const worker = await controllingWorker();
    const owner = await ownerClientId(worker);
    if (listeningOn !== navigator.serviceWorker) {
      listeningOn?.removeEventListener('message', receiveRequest);
      navigator.serviceWorker.addEventListener('message', receiveRequest);
      listeningOn = navigator.serviceWorker;
    }
    const token = crypto.randomUUID();
    const session: PlaybackSession = { source, ports: new Map() };
    sessions.set(token, session);
    return {
      url: `${location.origin}${ENCRYPTED_MEDIA_PATH}${encodeURIComponent(owner)}/${token}`,
      dispose() {
        if (sessions.get(token) !== session) return;
        sessions.delete(token);
        for (const [port, abort] of session.ports) {
          abort.abort();
          port.postMessage({ type: 'error' });
          port.close();
        }
        session.ports.clear();
        source.close();
        // Keep the keyless listener so a stale media URL fails immediately,
        // rather than waiting for the worker's missing-owner response timeout.
      }
    };
  } catch (error) {
    source.close();
    throw error;
  }
}
