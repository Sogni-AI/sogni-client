import { ApiError } from '../../ApiClient/index.js';

/**
 * Refuse an image-slot upload whose contents are text instead of image bytes.
 *
 * An image slot that receives text instead of an image (a file path string,
 * a fetched HTML page, or base64 text) cannot be decoded, so the job fails
 * after it has been submitted. Checking the leading bytes here turns that
 * into an error that names the slot, before any upload URL, upload or job
 * request.
 *
 * Only contents that cannot be an image are refused: a `data:` URL, an HTML
 * page, base64 text, or a string that is not markup. Image bytes, SVG markup
 * and anything this check does not recognise upload as before.
 */
export async function assertImageUploadBody(file: unknown, slot: string): Promise<void> {
  const found = await describeTextBody(file);
  if (!found) return;
  throw new ApiError(400, {
    status: 'error',
    errorCode: 0,
    message: `${slot} is not image data: ${found}. Upload the image file itself.`
  });
}

/** Enough leading bytes for an HTML doctype after a byte-order mark and some whitespace. */
const SNIFF_BYTES = 64;
/** Sixteen base64 characters: no binary image header is made only of them. */
const BASE64_HEAD = /^[A-Za-z0-9+/]{16}/;
const DATA_URL_HEAD = /^data:/i;
/** UTF-8 byte-order mark, read either as one character or as its three bytes. */
const HTML_HEAD = /^(?:﻿|\xef\xbb\xbf)?\s*<(?:!doctype\s+html|html[\s>])/i;
const MARKUP_HEAD = /^(?:﻿|\xef\xbb\xbf)?\s*</;

async function describeTextBody(file: unknown): Promise<string | null> {
  if (typeof file === 'string') {
    const head = file.slice(0, SNIFF_BYTES);
    // SVG markup is text and still uploads; any other string is not an image.
    return describeHead(head) ?? (MARKUP_HEAD.test(head) ? null : 'it is a string, not the file');
  }
  const bytes = await leadingBytes(file);
  return bytes ? describeHead(String.fromCharCode(...bytes)) : null;
}

async function leadingBytes(file: unknown): Promise<Uint8Array | null> {
  try {
    if (typeof Blob !== 'undefined' && file instanceof Blob) {
      return new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer());
    }
    if (ArrayBuffer.isView(file)) {
      return new Uint8Array(file.buffer, file.byteOffset, Math.min(file.byteLength, SNIFF_BYTES));
    }
    if (file instanceof ArrayBuffer) {
      return new Uint8Array(file, 0, Math.min(file.byteLength, SNIFF_BYTES));
    }
  } catch {
    // A file that can no longer be read fails at the upload, as it always has.
  }
  return null;
}

function describeHead(head: string): string | null {
  if (DATA_URL_HEAD.test(head)) return 'its contents are a data: URL';
  if (HTML_HEAD.test(head)) return 'its contents are an HTML page';
  // GIF's signature is letters and digits, and its size bytes can be too.
  if (!head.startsWith('GIF8') && BASE64_HEAD.test(head)) return 'its contents are base64 text';
  return null;
}
