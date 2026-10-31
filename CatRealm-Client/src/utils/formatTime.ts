import { useSettingsStore } from '../stores/settingsStore';

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

const MINUTE = 60;
const HOUR = 3600;
const DAY = 86400;

function shouldUse12HourClock(format?: '12' | '24'): boolean {
  const resolved = format ?? useSettingsStore.getState().timeFormat;
  return resolved !== '24';
}

function formatClockTime(date: Date, format?: '12' | '24'): string {
  const use12HourClock = shouldUse12HourClock(format);
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: use12HourClock,
    hourCycle: use12HourClock ? 'h12' : 'h23',
  });
}

export function formatTimestamp(unixSeconds: number, format?: '12' | '24'): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - unixSeconds;

  if (diff < MINUTE) return rtf.format(-diff, 'second');
  if (diff < HOUR) return rtf.format(-Math.floor(diff / MINUTE), 'minute');
  if (diff < DAY) return rtf.format(-Math.floor(diff / HOUR), 'hour');
  if (diff < DAY * 7) return rtf.format(-Math.floor(diff / DAY), 'day');

  const date = new Date(unixSeconds * 1000);
  const use12HourClock = shouldUse12HourClock(format);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: use12HourClock,
    hourCycle: use12HourClock ? 'h12' : 'h23',
  }).format(date);
}

export function formatMessageTime(unixSeconds: number, format?: '12' | '24'): string {
  const date = new Date(unixSeconds * 1000);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();

  const time = formatClockTime(date, format);

  if (isToday) return `Today at ${time}`;

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday at ${time}`;

  return `${date.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })} ${time}`;
}
