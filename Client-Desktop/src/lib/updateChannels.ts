export type DesktopUpdateChannel = {
  id: AppUpdateChannel;
  label: string;
  description?: string;
  prerelease: boolean;
  channelFile?: string;
  available: boolean;
};

export type DesktopUpdateChannelCatalog = {
  defaultChannel: AppUpdateChannel;
  channels: DesktopUpdateChannel[];
  updatedAt?: number;
};

export const DEFAULT_UPDATE_CHANNEL: AppUpdateChannel = 'latest';

export const FALLBACK_UPDATE_CHANNEL_CATALOG: DesktopUpdateChannelCatalog = {
  defaultChannel: DEFAULT_UPDATE_CHANNEL,
  channels: [
    {
      id: 'latest',
      label: 'Stable',
      description: 'Stable release builds.',
      prerelease: false,
      channelFile: 'latest.yml',
      available: true,
    },
    {
      id: 'dev',
      label: 'DEV',
      description: 'Development builds.',
      prerelease: true,
      channelFile: 'dev.yml',
      available: true,
    },
  ],
};

const SAFE_UPDATE_CHANNEL_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const SUPPORTED_UPDATE_CHANNEL_IDS = new Set<AppUpdateChannel>(['latest', 'dev']);

export function normalizeUpdateChannelId(value: unknown): AppUpdateChannel | null {
  const id = String(value ?? '').trim().toLowerCase();
  if (!SAFE_UPDATE_CHANNEL_ID.test(id) || !SUPPORTED_UPDATE_CHANNEL_IDS.has(id)) return null;
  return id as AppUpdateChannel;
}

function normalizeChannel(raw: unknown): DesktopUpdateChannel | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Record<string, unknown>;
  const id = normalizeUpdateChannelId(source.id);
  if (!id) return null;
  const label = typeof source.label === 'string' && source.label.trim()
    ? source.label.trim().slice(0, 64)
    : id;
  const description = typeof source.description === 'string' && source.description.trim()
    ? source.description.trim().slice(0, 240)
    : undefined;
  const channelFile = typeof source.channelFile === 'string' && source.channelFile.trim()
    ? source.channelFile.trim().slice(0, 80)
    : undefined;
  return {
    id,
    label,
    description,
    channelFile,
    prerelease: source.prerelease === undefined ? id !== DEFAULT_UPDATE_CHANNEL : source.prerelease === true,
    available: source.available !== false,
  };
}

export function normalizeUpdateChannelCatalog(raw: unknown): DesktopUpdateChannelCatalog {
  if (!raw || typeof raw !== 'object') return FALLBACK_UPDATE_CHANNEL_CATALOG;
  const source = raw as Record<string, unknown>;
  const rawChannels = Array.isArray(source.channels) ? source.channels : [];
  const channels = rawChannels
    .map(normalizeChannel)
    .filter((channel): channel is DesktopUpdateChannel => Boolean(channel));
  if (channels.length === 0) return FALLBACK_UPDATE_CHANNEL_CATALOG;

  const defaultChannel = normalizeUpdateChannelId(source.defaultChannel) ?? DEFAULT_UPDATE_CHANNEL;
  return {
    defaultChannel,
    channels,
    updatedAt: typeof source.updatedAt === 'number' && Number.isFinite(source.updatedAt) ? source.updatedAt : undefined,
  };
}

export function getAvailableUpdateChannels(catalog: DesktopUpdateChannelCatalog): DesktopUpdateChannel[] {
  return catalog.channels.filter((channel) => channel.available);
}

export function getDefaultAvailableUpdateChannel(catalog: DesktopUpdateChannelCatalog): AppUpdateChannel {
  const available = getAvailableUpdateChannels(catalog);
  if (available.some((channel) => channel.id === catalog.defaultChannel)) return catalog.defaultChannel;
  if (available.some((channel) => channel.id === DEFAULT_UPDATE_CHANNEL)) return DEFAULT_UPDATE_CHANNEL;
  return available[0]?.id ?? DEFAULT_UPDATE_CHANNEL;
}

export function isUpdateChannelAvailable(catalog: DesktopUpdateChannelCatalog, channelId: AppUpdateChannel): boolean {
  return catalog.channels.some((channel) => channel.id === channelId && channel.available);
}
