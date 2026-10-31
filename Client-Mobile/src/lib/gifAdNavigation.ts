/** Navigation policy for a Klipy ad displayed inside the GIF picker. */
export interface GifAdNavigationRequest {
  url: string;
  navigationType?: string;
  isTopFrame?: boolean;
  /** iOS reports false when a link or script requests a new window. */
  hasTargetFrame?: boolean;
  /** Added to Android's WebView request event by our react-native-webview patch. */
  hasGesture?: boolean;
}

export type GifAdNavigationDecision = 'allow' | 'open' | 'block';

export function isHttpAdUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export function decideGifAdNavigation(
  request: GifAdNavigationRequest,
  adUrl: string,
  initialLoadFinished: boolean,
): GifAdNavigationDecision {
  if (request.url === 'about:blank') return 'allow';
  if (!isHttpAdUrl(request.url)) return 'block';
  if (request.hasTargetFrame === false) {
    return request.navigationType === 'click' || request.hasGesture === true ? 'open' : 'block';
  }
  if (request.isTopFrame === false) return 'allow';
  if (request.url === adUrl) return 'allow';

  // iOS reports link activation; Android reports WebResourceRequest.hasGesture().
  // Redirects and ad scripts do not get either signal.
  if (request.navigationType === 'click' || request.hasGesture === true) return 'open';

  // Let the creative complete its initial redirect chain inside the WebView.
  // Later automatic navigations stay in the picker instead of opening a browser.
  return initialLoadFinished ? 'block' : 'allow';
}
