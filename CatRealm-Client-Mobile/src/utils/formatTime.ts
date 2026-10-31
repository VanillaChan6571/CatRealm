function clockTime(date: Date, hour12: boolean): string {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12,
    hourCycle: hour12 ? 'h12' : 'h23',
  });
}

/**
 * Formats a message timestamp the same way the desktop client does:
 *   - today          → "2:01 AM"
 *   - yesterday      → "Yesterday 8:43 PM"
 *   - older          → "Apr 28 8:43 PM"
 *
 * Pass use12Hour=false for 24-hour mode.
 */
export function formatMessageTimestamp(ms: number, use12Hour = true): string {
  const date = new Date(ms);
  const now = new Date();

  const time = clockTime(date, use12Hour);

  if (date.toDateString() === now.toDateString()) return time;

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday ${time}`;

  return `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${time}`;
}
