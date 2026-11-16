const UGC_IMAGE = /^(.*\/ugc\/images\/)([^/?#]+)\.(?:jpe?g|png|webp|gif|avif)$/i;

/**
 * The server-made WebP thumbnail (at most 1024 px) for a chat-upload image URL, or null when
 * the URL isn't one. Thumbnails only exist for uploads made since the server started generating
 * them, so callers must fall back to the original when this URL fails to load.
 */
export function uploadThumbnailUrl(src: string): string | null {
  const match = UGC_IMAGE.exec(src);
  return match ? `${match[1]}thumbs/${match[2]}.webp` : null;
}
