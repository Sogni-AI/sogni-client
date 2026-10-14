/**
 * Detect the content type of a reference file from its bytes.
 *
 * A browser `File`/`Blob` carries its own `type`. A Node `Buffer` is sniffed
 * by magic bytes. `slot` says which reference the buffer fills: a
 * Matroska/WebM container (EBML header) and an Ogg container carry either
 * audio or video, and the magic bytes do not say which, so the slot decides
 * between `audio/webm` and `video/webm` (`audio/ogg` and `video/ogg`).
 *
 * The declared type matters past the upload: the socket keeps audio guides the
 * Mac app's AVFoundation decoder cannot read (OGG, WebM) off Mac app workers
 * only when the type is declared; an undeclared guide is routed blind and the
 * render fails there (sogni-socket constants/appMlxWorker.js
 * APP_MLX_AUDIO_GUIDE_CONTENT_TYPES, 2026-10).
 *
 * Returns undefined when the bytes match nothing known.
 */
export function getFileContentType(
  file: File | Buffer | Blob,
  slot?: 'audio' | 'video'
): string | undefined {
  if (file instanceof Blob && 'type' in file && file.type) {
    return file.type;
  }
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(file)) {
    if (file.length >= 12) {
      if (file[0] === 0xff && file[1] === 0xd8 && file[2] === 0xff) return 'image/jpeg';
      if (file[0] === 0x89 && file[1] === 0x50 && file[2] === 0x4e && file[3] === 0x47) {
        return 'image/png';
      }
      if (file.toString('ascii', 0, 4) === 'RIFF' && file.toString('ascii', 8, 12) === 'WEBP') {
        return 'image/webp';
      }
      if (file.toString('ascii', 0, 3) === 'GIF') return 'image/gif';
      if (file.toString('ascii', 4, 8) === 'ftyp') {
        const brand = file.toString('ascii', 8, 12).toLowerCase();
        if (brand.includes('m4a') || brand.includes('m4b')) return 'audio/mp4';
        if (brand.includes('qt')) return 'video/quicktime';
        return 'video/mp4';
      }
      if (file.toString('ascii', 0, 4) === 'RIFF' && file.toString('ascii', 8, 12) === 'WAVE') {
        return 'audio/wav';
      }
      if (file.toString('ascii', 0, 4) === 'fLaC') return 'audio/flac';
      if (file.toString('ascii', 0, 4) === 'OggS')
        return slot === 'video' ? 'video/ogg' : 'audio/ogg';
      if (file[0] === 0x1a && file[1] === 0x45 && file[2] === 0xdf && file[3] === 0xa3) {
        return slot === 'audio' ? 'audio/webm' : 'video/webm';
      }
    }
    if (file.length >= 3 && file.toString('ascii', 0, 3) === 'ID3') return 'audio/mpeg';
    if (file.length >= 2 && file[0] === 0xff && (file[1] & 0xe0) === 0xe0) return 'audio/mpeg';
  }
  return undefined;
}
