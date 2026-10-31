import { useEffect, useState, type ImgHTMLAttributes, type SyntheticEvent } from 'react';

type AutoSizingChatImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'width' | 'height'> & {
  maxWidth: number;
  maxHeight: number;
  placeholderWidth?: number;
  placeholderHeight?: number;
};

export function AutoSizingChatImage({
  src,
  maxWidth,
  maxHeight,
  placeholderWidth = Math.min(maxWidth, 208),
  placeholderHeight = Math.min(maxHeight, 144),
  style,
  className,
  onLoad,
  onError,
  // Decode off the main thread so images entering view mid-scroll don't stall frames.
  decoding = 'async',
  ...props
}: AutoSizingChatImageProps) {
  const [dimensions, setDimensions] = useState({
    width: placeholderWidth,
    height: placeholderHeight,
  });
  // Which src has painted (or failed); the cat placeholder shows until then.
  const [loadedSrc, setLoadedSrc] = useState<string | undefined>();
  const [failedSrc, setFailedSrc] = useState<string | undefined>();

  useEffect(() => {
    setDimensions({ width: placeholderWidth, height: placeholderHeight });
  }, [src, placeholderWidth, placeholderHeight]);

  const handleLoad = (event: SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget;
    if (image.naturalWidth > 0 && image.naturalHeight > 0) {
      const scale = Math.min(1, maxWidth / image.naturalWidth, maxHeight / image.naturalHeight);
      setDimensions({
        width: Math.max(1, Math.round(image.naturalWidth * scale)),
        height: Math.max(1, Math.round(image.naturalHeight * scale)),
      });
    }
    setLoadedSrc(image.getAttribute('src') ?? undefined);
    onLoad?.(event);
  };

  const handleError = (event: SyntheticEvent<HTMLImageElement>) => {
    setFailedSrc(event.currentTarget.getAttribute('src') ?? undefined);
    onError?.(event);
  };

  return (
    <img
      {...props}
      src={src}
      decoding={decoding}
      className={className ? `chat-image-placeholder ${className}` : 'chat-image-placeholder'}
      data-loaded={src && loadedSrc === src ? '' : undefined}
      data-failed={src && failedSrc === src ? '' : undefined}
      width={dimensions.width}
      height={dimensions.height}
      // Callers pass `transition-all` for the NSFW blur fade; keep that, but
      // never animate the size. A 150ms width/height ease after load left
      // pinned chats short of the bottom, since the re-pin ran mid-animation.
      style={{
        transitionProperty: 'filter, opacity, transform, border-color, box-shadow',
        ...style,
        width: dimensions.width,
        height: dimensions.height,
      }}
      onLoad={handleLoad}
      onError={handleError}
    />
  );
}
