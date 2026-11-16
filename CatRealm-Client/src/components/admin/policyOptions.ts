// Shared values for thread settings and media settings (category, channel and thread level).

export const SYNC_WITH_CHANNEL = -1;
export const SLOWMODE_MAX_SECONDS = 21600;
export const AUTO_HIDE_DEFAULT_MINUTES = 2880;
export const AUTO_HIDE_MAX_MINUTES = 525600;

export const AUTO_HIDE_OPTIONS: Array<{ minutes: number; label: string }> = [
  { minutes: 60, label: '1 Hour' },
  { minutes: 1440, label: '24 Hours' },
  { minutes: 2880, label: '48 Hours (Default)' },
  { minutes: 4320, label: '3 Days' },
  { minutes: 10080, label: '1 Week' },
  { minutes: 20160, label: '2 Weeks' },
  { minutes: 30240, label: '3 Weeks' },
  { minutes: 43200, label: '1 Month' },
  { minutes: 0, label: 'Never' },
];

export type MediaFlag = 'spoiler' | 'nsfw' | 'lewd' | 'blood' | 'gore';
export type MediaFlags = Record<MediaFlag, boolean>;

export interface CategoryPolicy {
  id: string;
  name: string;
  threadSlowmode: number | null;
  threadAutoHideMinutes: number | null;
  media: MediaFlags;
}

export interface ChannelPolicy {
  channel: { id: string; type: string; nsfw: boolean; categoryId: string | null; slowmode: number };
  own: { threadSlowmode: number | null; threadAutoHideMinutes: number | null; media: MediaFlags };
  category: CategoryPolicy | null;
  effective: { threadSlowmode: number; threadAutoHideMinutes: number; media: MediaFlags };
}

export interface ThreadPolicy {
  threadId: string;
  channelId: string;
  own: { slowmode: number | null; autoHideMinutes: number | null };
  channel: { slowmode: number; autoHideMinutes: number };
  effective: { slowmode: number; autoHideMinutes: number };
}

export function formatMinutes(minutes: number): string {
  if (minutes === 0) return 'Never';
  const known = AUTO_HIDE_OPTIONS.find((option) => option.minutes === minutes);
  if (known) return known.label.replace(' (Default)', '');
  if (minutes % 1440 === 0) return `${minutes / 1440} days`;
  if (minutes % 60 === 0) return `${minutes / 60} hours`;
  return `${minutes} minutes`;
}

export function formatSeconds(seconds: number): string {
  if (seconds === 0) return 'Off';
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}

export function policyErrorText(error: unknown, fallback: string): string {
  const response = (error as { response?: { data?: { error?: unknown } } } | null)?.response;
  return typeof response?.data?.error === 'string' ? response.data.error : fallback;
}
