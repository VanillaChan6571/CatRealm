/** The YouTube wrapper's HTML is 16:9 regardless of its WebView height. */
export function theaterYouTubeFrame(width: number, height: number) {
  const availableWidth = Number.isFinite(width) ? Math.max(0, width) : 0;
  const availableHeight = Number.isFinite(height) ? Math.max(0, height) : 0;
  const playerWidth = Math.min(availableWidth, availableHeight * 16 / 9);
  return { width: playerWidth, height: playerWidth * 9 / 16 };
}

/** Fit media + controls to the actual screen body, not the full window height. */
export function theaterLayout(width: number, height: number, controlsHeight: number, fullscreen: boolean) {
  const split = !fullscreen && width >= 600 && width > height;
  const sidebarWidth = split ? Math.min(320, Math.max(240, Math.round(width * 0.3))) : 0;
  const playerWidth = Math.max(0, width - sidebarWidth);
  const playerHeight = fullscreen
    ? Math.max(0, height)
    : Math.max(0, Math.min(Math.round(playerWidth * 9 / 16), height - controlsHeight - (split ? 0 : 120)));
  return { split, sidebarWidth, playerWidth, playerHeight };
}
