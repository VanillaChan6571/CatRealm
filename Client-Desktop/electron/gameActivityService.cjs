const { EventEmitter } = require('events');
const { execFile } = require('child_process');
const { promisify } = require('util');
const GAME_CATALOG = require('./gameCatalog.cjs');

const execFileAsync = promisify(execFile);
const POLL_INTERVAL_MS = 15000;
const MAX_BUFFER = 2 * 1024 * 1024;
const GAME_LIBRARY_BASE_URL = process.env.CATREALM_GAME_LIBRARY_BASE_URL || 'https://auth.catrealm.app';
const GAME_LIBRARY_PAGE_SIZE = 100;
const GAME_LIBRARY_CACHE_TTL_MS = 5 * 60 * 1000;

function normalizeProcessName(value) {
  return String(value || '').trim().toLowerCase();
}

function parseWmiDate(rawValue) {
  const value = String(rawValue || '');
  const match = value.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\.\d+([+-])(\d{3})$/);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, offsetSign, offsetMinutesRaw] = match;
  const baseUtcMs = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second)
  );
  const offsetMinutes = Number(offsetMinutesRaw);
  if (!Number.isFinite(baseUtcMs) || !Number.isFinite(offsetMinutes)) return null;
  const adjustedUtcMs = offsetSign === '+'
    ? baseUtcMs - (offsetMinutes * 60 * 1000)
    : baseUtcMs + (offsetMinutes * 60 * 1000);
  return Math.floor(adjustedUtcMs / 1000);
}

function normalizeProcessRows(parsed) {
  if (!parsed) return [];
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  return rows.map((row) => ({
    name: String(row?.Name || '').trim(),
    processId: Number(row?.ProcessId || 0),
    startedAt: parseWmiDate(row?.CreationDate),
  })).filter((row) => row.name);
}

function matchCatalogEntry(processName) {
  const normalized = normalizeProcessName(processName);
  if (!normalized) return null;
  return GAME_CATALOG[normalized] || null;
}

class GameActivityService extends EventEmitter {
  constructor() {
    super();
    this._enabled = false;
    this._timer = null;
    this._pollInFlight = false;
    this._remoteCatalog = null;
    this._remoteCatalogFetchedAt = 0;
    this._remoteCatalogPromise = null;
    this._state = {
      supported: process.platform === 'win32',
      enabled: false,
      status: process.platform === 'win32' ? 'disabled' : 'unsupported',
      activity: null,
      lastError: null,
      updatedAt: Date.now(),
    };
  }

  invalidateCatalog() {
    this._remoteCatalog = null;
    this._remoteCatalogFetchedAt = 0;
  }

  async refreshCatalog() {
    this.invalidateCatalog();
    return this._getCatalog();
  }

  async refreshNow() {
    await this._pollNow();
    return this.getState();
  }

  getState() {
    return {
      ...this._state,
      activity: this._state.activity ? { ...this._state.activity } : null,
    };
  }

  async setEnabled(enabled) {
    const nextEnabled = !!enabled;
    if (!this._state.supported) {
      this._setState({
        enabled: false,
        status: 'unsupported',
        activity: null,
        lastError: null,
      });
      return this.getState();
    }

    this._enabled = nextEnabled;
    if (!nextEnabled) {
      this._stopTimer();
      this._setState({
        enabled: false,
        status: 'disabled',
        activity: null,
        lastError: null,
      });
      return this.getState();
    }

    this._setState({
      enabled: true,
      status: 'detecting',
      lastError: null,
    });
    await this._pollNow();
    this._startTimer();
    return this.getState();
  }

  _startTimer() {
    this._stopTimer();
    this._timer = setInterval(() => {
      this._pollNow().catch(() => {});
    }, POLL_INTERVAL_MS);
  }

  _stopTimer() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  _setState(patch) {
    const nextState = {
      ...this._state,
      ...patch,
      updatedAt: Date.now(),
    };
    const prevSignature = JSON.stringify(this._state);
    const nextSignature = JSON.stringify(nextState);
    this._state = nextState;
    if (prevSignature !== nextSignature) {
      this.emit('state', this.getState());
    }
  }

  async _pollNow() {
    if (!this._enabled || !this._state.supported || this._pollInFlight) return;
    this._pollInFlight = true;
    try {
      const catalog = await this._getCatalog();
      const activity = await detectWindowsGameActivity(catalog);
      this._setState({
        enabled: true,
        status: activity ? 'active' : 'idle',
        activity,
        lastError: null,
      });
    } catch (error) {
      this._setState({
        enabled: true,
        status: 'error',
        activity: null,
        lastError: error instanceof Error ? error.message : 'Failed to inspect running games',
      });
    } finally {
      this._pollInFlight = false;
    }
  }

  async _getCatalog() {
    if (this._remoteCatalog && (Date.now() - this._remoteCatalogFetchedAt) < GAME_LIBRARY_CACHE_TTL_MS) {
      return { ...GAME_CATALOG, ...this._remoteCatalog };
    }

    if (!this._remoteCatalogPromise) {
      this._remoteCatalogPromise = (async () => {
        try {
          const remoteCatalog = await fetchRemoteGameCatalog();
          this._remoteCatalog = remoteCatalog;
          this._remoteCatalogFetchedAt = Date.now();
        } catch {
          // Keep using the bundled catalog if live lookup fails.
        } finally {
          this._remoteCatalogPromise = null;
        }
        return { ...GAME_CATALOG, ...(this._remoteCatalog || {}) };
      })();
    }

    return this._remoteCatalogPromise;
  }
}

async function fetchRemoteGameCatalog() {
  if (typeof fetch !== 'function') return {};

  const catalog = {};
  let page = 1;
  let total = 0;

  while (page === 1 || ((page - 1) * GAME_LIBRARY_PAGE_SIZE) < total) {
    const url = `${GAME_LIBRARY_BASE_URL}/api/gamelibrary/games?page=${page}&limit=${GAME_LIBRARY_PAGE_SIZE}`;
    const res = await fetch(url, {
      headers: {
        'X-CatRealm-Client': 'desktop',
      },
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch Game Library catalog (${res.status})`);
    }

    const data = await res.json();
    const games = Array.isArray(data?.games) ? data.games : [];
    total = Number(data?.total || games.length);

    for (const game of games) {
      const title = typeof game?.title === 'string' ? game.title.trim() : '';
      const processNames = Array.isArray(game?.processNames) ? game.processNames : [];
      if (!title) continue;
      for (const processName of processNames) {
        const normalized = normalizeProcessName(processName);
        if (!normalized) continue;
        catalog[normalized] = { title };
      }
    }

    if (games.length < GAME_LIBRARY_PAGE_SIZE) break;
    page += 1;
  }

  return catalog;
}

async function detectWindowsGameActivity(catalog) {
  if (process.platform !== 'win32') return null;

  const { stdout } = await execFileAsync(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      'Get-CimInstance Win32_Process | Select-Object Name,CreationDate,ProcessId | ConvertTo-Json -Compress',
    ],
    {
      windowsHide: true,
      maxBuffer: MAX_BUFFER,
    }
  );

  const trimmed = String(stdout || '').trim();
  if (!trimmed) return null;

  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  const matches = normalizeProcessRows(parsed)
    .map((row) => {
      const entry = catalog?.[normalizeProcessName(row.name)] || matchCatalogEntry(row.name);
      if (!entry) return null;
      return {
        processName: row.name,
        processId: row.processId,
        activityType: 'Playing',
        activityText: entry.title,
        activityStartedAt: row.startedAt ?? null,
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      const startDiff = (b.activityStartedAt || 0) - (a.activityStartedAt || 0);
      if (startDiff !== 0) return startDiff;
      return (b.processId || 0) - (a.processId || 0);
    });

  return matches[0] || null;
}

module.exports = {
  GameActivityService,
};
