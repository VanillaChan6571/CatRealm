import { useEffect, useState } from 'react';

function formatExpiryLabel(expiresAt: number): string {
  const diff = expiresAt - Date.now();
  if (diff <= 0) return 'Expiring soon';
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `Deletes in ${mins}m`;
  const hours = Math.floor(diff / 3600000);
  if (hours < 24) return `Deletes in ${hours}h`;
  const days = Math.floor(diff / 86400000);
  return `Deletes in ${days}d`;
}

function ExpiryClockBadge({ expiresAt }: { expiresAt: number }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div className="relative flex items-center" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="text-yellow-400 cursor-default shrink-0">
        <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z" />
      </svg>
      {hovered && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 whitespace-nowrap rounded bg-bg-tooltip px-2 py-1 text-xs text-text-primary shadow-md pointer-events-none z-20">
          {formatExpiryLabel(expiresAt)}
        </div>
      )}
    </div>
  );
}
import type { DMMessage } from '../../types';
import { AudioPlayer } from './AudioPlayer';
import { useUIStore } from '../../stores/uiStore';
import { useContentSocialStore } from '../../stores/contentSocialStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { AutoSizingChatImage } from './AutoSizingChatImage';
import { getNsfwSubtagLabels, shouldBlurAttachmentForNsfwTags } from '../../utils/nsfw';

type DMAttachmentPreviewProps = {
  message: DMMessage;
  authBase: string;
  senderUsername?: string | null;
  senderAvatarUrl?: string | null;
};

function resolveDmAttachmentUrl(authBase: string, attachmentUrl?: string | null) {
  if (!attachmentUrl) return null;
  if (/^https?:\/\//i.test(attachmentUrl)) return attachmentUrl;
  if (attachmentUrl.startsWith('/')) return `${authBase}${attachmentUrl}`;
  return `${authBase}/${attachmentUrl}`;
}

function getDmDisplayUrl(authBase: string, url: string, thumbnailUrl: string | null | undefined, useThumbnail: boolean) {
  return resolveDmAttachmentUrl(authBase, useThumbnail ? (thumbnailUrl || url) : url) ?? url;
}

export function formatDmAttachmentSize(bytes?: number | null) {
  if (!bytes || Number.isNaN(bytes) || bytes < 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DMAttachmentPreview({
  message,
  authBase,
  senderUsername,
  senderAvatarUrl,
}: DMAttachmentPreviewProps) {
  const openModal = useUIStore((s) => s.openModal);
  const allowNsfw = useContentSocialStore((s) => s.allowNsfw);
  const nsfwLewds = useContentSocialStore((s) => s.nsfwLewds);
  const nsfwBlood = useContentSocialStore((s) => s.nsfwBlood);
  const nsfwGore = useContentSocialStore((s) => s.nsfwGore);
  const enableImageThumbnailing = useSettingsStore((s) => s.enableImageThumbnailing);
  const [mediaRevealed, setMediaRevealed] = useState(false);

  useEffect(() => {
    setMediaRevealed(false);
  }, [message.id]);

  // Gallery mode — multiple attachments
  const galleryItems = message.attachments && message.attachments.length > 1 ? message.attachments : null;
  if (galleryItems) {
    const galleryShouldBlur = !mediaRevealed && shouldBlurAttachmentForNsfwTags(
      message.nsfwTags,
      { allowNsfw, nsfwLewds, nsfwBlood, nsfwGore }
    );
    const galleryIsSpoilerOnly = !mediaRevealed && !!(message.nsfwTags?.includes('spoiler')) && (message.nsfwTags?.length ?? 0) === 1;
    const galleryNsfwSubtagLabels = getNsfwSubtagLabels(message.nsfwTags);
    const resolvedItems = galleryItems.map((att) => ({
      url: resolveDmAttachmentUrl(authBase, att.url) ?? att.url,
      displayUrl: getDmDisplayUrl(authBase, att.url, att.thumbnailUrl ?? att.thumbnail_url, enableImageThumbnailing),
      type: att.type ?? att.mime ?? null,
      name: att.name ?? null,
      size: att.size ?? null,
      author: senderUsername ?? null,
      avatarUrl: senderAvatarUrl ?? null,
      createdAt: message.createdAt ? Math.floor(message.createdAt / 1000) : null,
    }));
    const openGallery = (startIndex: number) => {
      const { url: startUrl, type, name, size, author, avatarUrl, createdAt } = resolvedItems[startIndex];
      openModal('mediaViewer', {
        url: startUrl,
        type,
        name,
        size,
        author,
        avatarUrl,
        createdAt,
        items: resolvedItems,
        index: startIndex,
      });
    };
    return (
      <div className="mt-2 relative inline-block">
        <div className="flex flex-wrap gap-2">
        {resolvedItems.map((item, i) => {
          const isImg = (item.type || '').startsWith('image/') || /\.(png|jpe?g|gif|webp|avif)(\?|$)/i.test(item.url);
          const isVid = (item.type || '').startsWith('video/');
          return (
            <div key={i} className="relative shrink-0">
              {isImg ? (
                <img
                  src={item.displayUrl}
                  alt={item.name ?? 'Image'}
                  className={`w-32 h-24 object-cover rounded-lg border border-border cursor-zoom-in transition-all ${galleryShouldBlur ? 'blur-md brightness-50' : ''}`}
                  onClick={() => { if (galleryShouldBlur) { setMediaRevealed(true); return; } openGallery(i); }}
                />
              ) : isVid ? (
                <video
                  src={item.url}
                  className={`w-32 h-24 object-cover rounded-lg border border-border cursor-zoom-in bg-black transition-all ${galleryShouldBlur ? 'blur-md brightness-50' : ''}`}
                  muted
                  onClick={() => { if (galleryShouldBlur) { setMediaRevealed(true); return; } openGallery(i); }}
                />
              ) : (
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm text-text-primary hover:bg-bg-hover"
                >
                  📎 {item.name ?? 'File'}
                </a>
              )}
            </div>
          );
        })}
        </div>
        {galleryShouldBlur && (
          <button
            type="button"
            onClick={() => setMediaRevealed(true)}
            className="absolute inset-0 flex flex-col items-center justify-center rounded-lg bg-black/45 text-white text-xs font-medium px-2 text-center"
          >
            <span>{galleryIsSpoilerOnly ? 'Spoiler - Click to reveal' : 'NSFW Media - Click to reveal'}</span>
            {!galleryIsSpoilerOnly && (
              <span className="mt-1 text-[11px] font-normal text-white/90">
                Subtags: [{galleryNsfwSubtagLabels.length > 0 ? galleryNsfwSubtagLabels.join(', ') : 'Tagged'}]
              </span>
            )}
          </button>
        )}
      </div>
    );
  }

  const url = resolveDmAttachmentUrl(authBase, message.attachmentUrl);
  if (!url) return null;

  const primaryThumbnailUrl = message.attachments?.[0]?.thumbnailUrl ?? message.attachments?.[0]?.thumbnail_url ?? null;
  const displayUrl = enableImageThumbnailing
    ? (resolveDmAttachmentUrl(authBase, primaryThumbnailUrl) ?? url)
    : url;
  const mime = message.attachmentType || '';
  const name = message.attachmentName || 'Attachment';
  const size = formatDmAttachmentSize(message.attachmentSize);
  const shouldBlurAttachment = !mediaRevealed && shouldBlurAttachmentForNsfwTags(
    message.nsfwTags,
    { allowNsfw, nsfwLewds, nsfwBlood, nsfwGore }
  );
  const isSpoilerOnly = !mediaRevealed && !!(message.nsfwTags?.includes('spoiler')) && (message.nsfwTags?.length ?? 0) === 1;
  const nsfwSubtagLabels = getNsfwSubtagLabels(message.nsfwTags);

  const openMediaViewer = () => {
    openModal('mediaViewer', {
      url,
      type: mime || null,
      name: message.attachmentName ?? null,
      author: senderUsername ?? null,
      avatarUrl: senderAvatarUrl ?? null,
      createdAt: message.createdAt ? Math.floor(message.createdAt / 1000) : null,
      size: message.attachmentSize ?? null,
    });
  };

  if (mime.startsWith('image/')) {
    return (
      <div className="relative inline-block max-w-xl">
        <AutoSizingChatImage
          src={displayUrl}
          alt={name}
          maxWidth={576}
          maxHeight={384}
          placeholderWidth={320}
          placeholderHeight={180}
          className={`mt-2 rounded-lg border border-border bg-bg-input object-contain cursor-zoom-in transition-all ${
            shouldBlurAttachment ? 'blur-md brightness-50' : ''
          }`}
          onClick={() => {
            if (shouldBlurAttachment) {
              setMediaRevealed(true);
              return;
            }
            openMediaViewer();
          }}
        />
        {shouldBlurAttachment && (
          <button
            type="button"
            onClick={() => setMediaRevealed(true)}
            className="absolute inset-0 mt-2 flex flex-col items-center justify-center rounded-lg bg-black/45 text-white text-xs font-medium px-2 text-center"
          >
            <span>{isSpoilerOnly ? 'Spoiler - Click to reveal' : 'NSFW Media - Click to reveal'}</span>
            {!isSpoilerOnly && (
              <span className="mt-1 text-[11px] font-normal text-white/90">
                Subtags: [{nsfwSubtagLabels.length > 0 ? nsfwSubtagLabels.join(', ') : 'Tagged'}]
              </span>
            )}
          </button>
        )}
      </div>
    );
  }

  if (mime.startsWith('video/')) {
    return (
      <div className="relative inline-block max-w-xl">
        <video
          src={url}
          controls
          preload="metadata"
          className={`mt-2 max-w-xl max-h-96 rounded-lg border border-border bg-black cursor-zoom-in transition-all ${
            shouldBlurAttachment ? 'blur-md brightness-50' : ''
          }`}
          onClick={() => {
            if (shouldBlurAttachment) {
              setMediaRevealed(true);
              return;
            }
            openMediaViewer();
          }}
        />
        {shouldBlurAttachment && (
          <button
            type="button"
            onClick={() => setMediaRevealed(true)}
            className="absolute inset-0 mt-2 flex flex-col items-center justify-center rounded-lg bg-black/45 text-white text-xs font-medium px-2 text-center"
          >
            <span>{isSpoilerOnly ? 'Spoiler - Click to reveal' : 'NSFW Media - Click to reveal'}</span>
            {!isSpoilerOnly && (
              <span className="mt-1 text-[11px] font-normal text-white/90">
                Subtags: [{nsfwSubtagLabels.length > 0 ? nsfwSubtagLabels.join(', ') : 'Tagged'}]
              </span>
            )}
          </button>
        )}
      </div>
    );
  }

  if (mime.startsWith('audio/')) {
    const isExpired = typeof message.voiceExpiresAt === 'number' && message.voiceExpiresAt > 0 && Date.now() > message.voiceExpiresAt;
    if (isExpired) {
      return (
        <div className="mt-2 flex items-center gap-2 text-xs text-text-muted italic">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="opacity-50">
            <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.91-3c-.49 0-.9.36-.98.85C16.52 14.2 14.47 16 12 16s-4.52-1.8-4.93-4.15c-.08-.49-.49-.85-.98-.85-.61 0-1.09.54-1 1.14.49 3 2.89 5.35 5.91 5.78V20c0 .55.45 1 1 1s1-.45 1-1v-2.08c3.02-.43 5.42-2.78 5.91-5.78.1-.6-.39-1.14-1-1.14z" />
          </svg>
          Voice message expired
        </div>
      );
    }
    return (
      <div className="mt-2 inline-flex items-center gap-1.5">
        <AudioPlayer src={url} />
        {typeof message.voiceExpiresAt === 'number' && message.voiceExpiresAt > 0 && (
          <ExpiryClockBadge expiresAt={message.voiceExpiresAt} />
        )}
      </div>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-2 inline-flex items-center gap-3 rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm text-text-primary hover:bg-bg-hover"
    >
      <span>📎 {name}</span>
      {size ? <span className="text-text-muted">({size})</span> : null}
    </a>
  );
}
