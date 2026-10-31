import { useState } from 'react';

interface GameIconProps {
  iconUrl: string | null | undefined;
  size?: number;
  className?: string;
}

export function GameIcon({ iconUrl, size = 64, className }: GameIconProps) {
  const [loadFailed, setLoadFailed] = useState(false);

  if (!iconUrl || loadFailed) {
    return (
      <span
        style={{ width: size, height: size, fontSize: size * 0.6 }}
        className={`inline-flex items-center justify-center select-none ${className ?? ''}`}
      >
        🎮
      </span>
    );
  }

  return (
    <img
      src={iconUrl}
      width={size}
      height={size}
      style={{ width: size, height: size }}
      className={`object-contain ${className ?? ''}`}
      onError={() => setLoadFailed(true)}
      alt=""
    />
  );
}
