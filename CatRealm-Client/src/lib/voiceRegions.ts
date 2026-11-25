import { AUTH_BASE } from './authApi';
export type CentralVoiceRegion = 'eu' | 'us-central';
/** 'auto' picks the lowest-latency region; otherwise a fixed region id. */
export type VoiceRegionPreference = 'auto' | CentralVoiceRegion;
export type RegionLatency = { id: CentralVoiceRegion; label: string; ms: number | null };

type RegionEndpoint = { id: CentralVoiceRegion; label?: string; url: string; probeUrl: string };
type Discovery = { ok?: boolean; version?: number; enabled?: boolean; regions?: RegionEndpoint[] };

const KNOWN_REGIONS: Record<CentralVoiceRegion, { host: string; label: string; short: string }> = {
  eu: { host: 'voice-eu.catrealm.app', label: 'EU', short: 'EU' },
  'us-central': { host: 'voice-us.catrealm.app', label: 'US Central', short: 'US' },
};
const PREFERENCE_KEY = 'catrealm.voiceRegionPreference';
const CACHE_MS = 10 * 60 * 1000;
let cached: { region: CentralVoiceRegion; at: number } | null = null;
let inFlight: Promise<CentralVoiceRegion> | null = null;
let preference: VoiceRegionPreference | null = null;

function isRegion(value: unknown): value is CentralVoiceRegion {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(KNOWN_REGIONS, value);
}

function validEndpoint(value: unknown): value is RegionEndpoint {
  if (!value || typeof value !== 'object') return false;
  const region = value as RegionEndpoint;
  if (!isRegion(region.id)) return false;
  try {
    const media = new URL(region.url);
    const probe = new URL(region.probeUrl);
    return media.protocol === 'wss:' && probe.protocol === 'https:'
      && media.hostname === KNOWN_REGIONS[region.id].host
      && probe.hostname === media.hostname
      && probe.pathname === '/region-probe';
  } catch {
    return false;
  }
}

async function timedFetch(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

async function medianProbe(endpoint: RegionEndpoint): Promise<number> {
  const samples: number[] = [];
  for (let i = 0; i < 3; i += 1) {
    const started = Date.now();
    try {
      const separator = endpoint.probeUrl.includes('?') ? '&' : '?';
      const response = await timedFetch(`${endpoint.probeUrl}${separator}sample=${started}-${i}`, 900);
      if (response.status === 204) samples.push(Date.now() - started);
    } catch { /* Another sample may still succeed. */ }
  }
  if (!samples.length) return Number.POSITIVE_INFINITY;
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)];
}

/** Regions Central currently offers, or [] when region routing is off/unreachable. */
async function fetchRegions(): Promise<RegionEndpoint[]> {
  try {
    const response = await timedFetch(`${AUTH_BASE}/api/media/regions`, 2500);
    if (!response.ok) return [];
    const discovery = await response.json() as Discovery;
    if (!discovery.ok || discovery.version !== 1 || !discovery.enabled || !Array.isArray(discovery.regions)) return [];
    return discovery.regions.filter(validEndpoint);
  } catch {
    return [];
  }
}

/** Probe every offered region in parallel (ms is null when unreachable). */
export async function measureVoiceRegions(): Promise<RegionLatency[]> {
  const endpoints = await fetchRegions();
  const results = await Promise.all(endpoints.map(async (endpoint) => {
    const ms = await medianProbe(endpoint);
    return { id: endpoint.id, label: endpoint.label || voiceRegionLabel(endpoint.id), ms: Number.isFinite(ms) ? ms : null };
  }));
  const fastest = results.filter((r) => r.ms !== null).sort((a, b) => (a.ms as number) - (b.ms as number))[0];
  if (fastest) cached = { region: fastest.id, at: Date.now() };
  return results;
}

async function measurePreference(): Promise<CentralVoiceRegion> {
  const pref = await getVoiceRegionPreference();
  const regions = await measureVoiceRegions();
  if (pref !== 'auto' && regions.some((r) => r.id === pref)) return pref;
  const fastest = regions.filter((r) => r.ms !== null).sort((a, b) => (a.ms as number) - (b.ms as number))[0];
  return fastest?.id ?? 'eu';
}

export async function getVoiceRegionPreference(): Promise<VoiceRegionPreference> {
  if (preference) return preference;
  const stored = await readPreference();
  preference = stored === 'auto' || isRegion(stored) ? stored : 'auto';
  return preference;
}

export async function setVoiceRegionPreference(next: VoiceRegionPreference): Promise<void> {
  preference = next;
  cached = null;
  await writePreference(next);
}

export async function getPreferredVoiceRegion(options: { refresh?: boolean } = {}): Promise<CentralVoiceRegion> {
  const pref = await getVoiceRegionPreference();
  if (pref === 'auto' && !options.refresh && cached && Date.now() - cached.at < CACHE_MS) return cached.region;
  if (!inFlight) {
    inFlight = measurePreference().then((region) => {
      if (pref === 'auto') cached = { region, at: Date.now() };
      return region;
    }).finally(() => { inFlight = null; });
  }
  return inFlight;
}

export function warmVoiceRegionPreference(): void {
  void getPreferredVoiceRegion();
}

export async function centralVoiceRegionsEnabled(): Promise<boolean> {
  const regions = await fetchRegions();
  return regions.some((r) => r.id === 'eu') && regions.some((r) => r.id === 'us-central');
}

export const voiceRegionShortLabel = (region: CentralVoiceRegion) => KNOWN_REGIONS[region]?.short ?? region;
export const voiceRegionLabel = (region: CentralVoiceRegion) => KNOWN_REGIONS[region]?.label ?? region;

async function readPreference(): Promise<string | null> {
  try { return window.localStorage.getItem(PREFERENCE_KEY); } catch { return null; }
}

async function writePreference(value: VoiceRegionPreference): Promise<void> {
  try { window.localStorage.setItem(PREFERENCE_KEY, value); } catch { /* Storage blocked: keep in memory. */ }
}
