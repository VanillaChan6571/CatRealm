/** Width of the tablet right pane (members, threads, pins). */
export const TABLET_RIGHT_PANE_WIDTH = 280;

/** Narrowest chat column worth keeping beside a docked right pane. */
export const TABLET_MIN_CHAT_WIDTH = 360;

/**
 * Whether the tablet right pane fits beside the chat. When it does not (a
 * 10-inch tablet in portrait), the pane opens over the chat instead of
 * squeezing the messages into a column a few words wide.
 */
export function tabletRightPaneDocked(windowWidth: number, leftColumnWidth: number): boolean {
  return windowWidth - leftColumnWidth - TABLET_RIGHT_PANE_WIDTH >= TABLET_MIN_CHAT_WIDTH;
}
