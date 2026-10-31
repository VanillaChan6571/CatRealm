/**
 * Archive attachments (zip/rar/7z) for realm channels. Browsers report these under several
 * MIME names, and Windows often gives .rar no type at all, so the extension also counts; the
 * realm verifies the file's signature bytes before keeping it.
 */
const ARCHIVE_EXTENSIONS = ['.zip', '.rar', '.7z'];
const ARCHIVE_MIME_TYPES = new Set([
  'application/zip',
  'application/x-zip-compressed',
  'application/vnd.rar',
  'application/x-rar-compressed',
  'application/x-rar',
  'application/x-7z-compressed',
]);

export const ARCHIVE_ACCEPT = ARCHIVE_EXTENSIONS.join(',');

export function isArchiveMime(mime: string | null | undefined): boolean {
  return ARCHIVE_MIME_TYPES.has(mime ?? '');
}

export function isArchiveFile(file: { name: string; type: string }): boolean {
  if (isArchiveMime(file.type)) return true;
  const name = file.name.toLowerCase();
  return (!file.type || file.type === 'application/octet-stream') && ARCHIVE_EXTENSIONS.some((ext) => name.endsWith(ext));
}
