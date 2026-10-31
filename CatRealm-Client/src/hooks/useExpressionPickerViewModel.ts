import { useState, useEffect, useMemo, useCallback } from 'react';
import axios from 'axios';
import { isHttpGatewayRealm } from '../lib/httpRealmGateway';
import { useAuthStore } from '../stores/authStore';
import { useServerStore } from '../stores/serverStore';
import { AUTH_BASE, createAuthenticatedApi } from '../lib/authApi';
import { createApi } from '../lib/api';
import { resolveAvatarUrl } from '../utils/avatar';
import {
  type ExpressionItem,
  type ExpressionManifest,
  type PickerServer,
  type PickerExpressionItem,
  PERSONAL_PICKER_SERVER_URL,
  DEFAULT_PICKER_SERVER_URL,
  EMPTY_EXPRESSION_MANIFEST as EMPTY_MANIFEST,
  normalizeServerOrigin,
  resolveServerIcon,
} from '../lib/expressions';
import {
  type DefaultEmojiCategory,
  type EmojiMetadataLookup,
  DEFAULT_EMOJI_CATEGORIES,
  DEFAULT_CATEGORY_SEARCH_KEYWORDS,
  normalizeEmojiSearchText,
  toEmojiSearchTerms,
  normalizeEmojiGlyph,
  loadEmojiMetadataLookup,
  getEmojiMetadataLookupCache,
} from '../lib/emojiMetadata';
import {
  useDefaultEmojiSearchAdapter,
  useComposerExpressionPickerActions,
  useExpressionPickerAdapter,
  useExpressionPickerDataAdapter,
} from '../messaging/chatlib/composerBridge';

type ExpressionPickerViewModelOptions = {
  currentServerUrl: string | null;
  canUseExternalEmojis: boolean;
  canUseExternalStickers: boolean;
  reactionPickerMessageId: string | null;
  onClearReactionPicker?: () => void;
};

export function useExpressionPickerViewModel(opts: ExpressionPickerViewModelOptions) {
  const {
    currentServerUrl,
    canUseExternalEmojis,
    canUseExternalStickers,
    onClearReactionPicker,
  } = opts;

  const user = useAuthStore((s) => s.user);
  const serverInfo = useAuthStore((s) => s.serverInfo);
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const token = useAuthStore((s) => s.token);
  const servers = useServerStore((s) => s.servers);
  const authOrigin = useMemo(() => normalizeServerOrigin(AUTH_BASE), []);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerTab, setPickerTab] = useState<'emojis' | 'stickers'>('emojis');
  const [emojiSearchQuery, setEmojiSearchQuery] = useState('');
  const [defaultEmojiCategory, setDefaultEmojiCategory] = useState<DefaultEmojiCategory>('People');
  const [selectedExpressionServerUrl, setSelectedExpressionServerUrl] = useState<string | null>(null);
  const [expressionStateByServer, setExpressionStateByServer] = useState<Record<string, { loading: boolean; data: ExpressionManifest | null; error: string | null }>>({});
  const [personalManifest, setPersonalManifest] = useState<ExpressionManifest | null>(null);
  const [emojiMetadataLookup, setEmojiMetadataLookup] = useState<EmojiMetadataLookup | null>(() => getEmojiMetadataLookupCache());

  // --- Expression server list ---
  const expressionServers = useMemo<PickerServer[]>(() => {
    const deduped = new Map<string, PickerServer>();

    if (user?.accountType === 'central') {
      servers.forEach((entry) => {
        deduped.set(entry.url, {
          url: entry.url,
          name: entry.name || entry.info?.name || entry.url,
          icon: resolveServerIcon(entry.url, entry.icon || entry.info?.serverIcon || null),
          token: entry.token,
          isCurrent: !!currentServerUrl && entry.url === currentServerUrl,
        });
      });
    }

    const serverOrigin = normalizeServerOrigin(serverUrl);
    if (serverUrl && serverOrigin && serverOrigin !== authOrigin && !deduped.has(serverUrl)) {
      deduped.set(serverUrl, {
        url: serverUrl,
        name: serverInfo?.name || 'Current Server',
        icon: resolveServerIcon(serverUrl, serverInfo?.serverIcon || null),
        token: token || undefined,
        isCurrent: !!currentServerUrl && serverUrl === currentServerUrl,
      });
    }

    const sorted = Array.from(deduped.values()).sort((a, b) => {
      if (a.isCurrent && !b.isCurrent) return -1;
      if (!a.isCurrent && b.isCurrent) return 1;
      return a.name.localeCompare(b.name);
    });

    const personalIcon = resolveAvatarUrl(
      user?.avatar ?? undefined,
      currentServerUrl || serverUrl || AUTH_BASE,
      user?.accountType
    ) || undefined;

    const withSpecial: PickerServer[] = [];
    if (user?.accountType === 'central') {
      withSpecial.push({
        url: PERSONAL_PICKER_SERVER_URL,
        name: 'Personal',
        icon: personalIcon,
        isCurrent: false,
        isPersonal: true,
      });
    }

    withSpecial.push(...sorted);
    withSpecial.push({
      url: DEFAULT_PICKER_SERVER_URL,
      name: 'Default',
      isCurrent: false,
      isDefault: true,
    });
    return withSpecial;
  }, [user?.accountType, user?.avatar, servers, serverUrl, serverInfo?.name, serverInfo?.serverIcon, token, currentServerUrl, authOrigin]);

  const visibleExpressionServers = useMemo(() => {
    const available = expressionServers.filter((entry) => !isHttpGatewayRealm(entry.url));
    if (canUseExternalEmojis || canUseExternalStickers) return available;
    return available.filter((entry) => entry.isPersonal || entry.isCurrent || entry.isDefault);
  }, [expressionServers, canUseExternalEmojis, canUseExternalStickers]);

  const currentExpressionServer = useMemo(
    () => visibleExpressionServers.find((entry) => {
      if (entry.isDefault || entry.isPersonal || !currentServerUrl || entry.url !== currentServerUrl) return false;
      const origin = normalizeServerOrigin(entry.url);
      return !!origin && origin !== authOrigin;
    })
      ?? visibleExpressionServers.find((entry) => {
        if (!entry.isCurrent || entry.isDefault || entry.isPersonal) return false;
        const origin = normalizeServerOrigin(entry.url);
        return !!origin && origin !== authOrigin;
      })
      ?? null,
    [visibleExpressionServers, currentServerUrl, authOrigin]
  );

  const currentServerManifest = currentExpressionServer
    ? expressionStateByServer[currentExpressionServer.url]?.data ?? null
    : null;
  const currentServerEmoteItems = currentServerManifest
    ? [...currentServerManifest.emotes, ...currentServerManifest['anim-emotes']]
    : [];
  const personalEmoteItems = personalManifest
    ? [...personalManifest['anim-emotes'], ...personalManifest.emotes]
    : [];

  // --- Manifest loading ---
  const loadManifest = useCallback(async (entry: PickerServer) => {
    if (entry.isDefault || entry.isPersonal || isHttpGatewayRealm(entry.url)) return;
    const origin = normalizeServerOrigin(entry.url);
    if (!origin || origin === authOrigin) return;
    setExpressionStateByServer((prev) => {
      const existing = prev[entry.url];
      if (existing?.loading || existing?.data) return prev;
      return {
        ...prev,
        [entry.url]: {
          loading: true,
          data: existing?.data ?? null,
          error: null,
        },
      };
    });

    try {
      const api = createApi(entry.url, entry.token);
      const res = await api.get('/api/expressions/manifest');
      const manifest: ExpressionManifest = {
        emotes: Array.isArray(res.data?.emotes) ? res.data.emotes : [],
        'anim-emotes': Array.isArray(res.data?.['anim-emotes']) ? res.data['anim-emotes'] : [],
        stickers: Array.isArray(res.data?.stickers) ? res.data.stickers : [],
        'anim-stickers': Array.isArray(res.data?.['anim-stickers']) ? res.data['anim-stickers'] : [],
      };
      setExpressionStateByServer((prev) => ({
        ...prev,
        [entry.url]: { loading: false, data: manifest, error: null },
      }));
    } catch (err) {
      const msg = axios.isAxiosError(err) ? err.response?.data?.error : null;
      setExpressionStateByServer((prev) => ({
        ...prev,
        [entry.url]: { loading: false, data: null, error: msg || 'Failed to load expressions' },
      }));
    }
  }, [authOrigin]);

  const loadPersonalManifest = useCallback(async () => {
    if (user?.accountType !== 'central' || !token) {
      setPersonalManifest(null);
      return;
    }
    try {
      const api = createAuthenticatedApi();
      const res = await api.get('/api/profile/personal-expressions/manifest');
      const manifest: ExpressionManifest = {
        emotes: Array.isArray(res.data?.emotes) ? res.data.emotes : [],
        'anim-emotes': Array.isArray(res.data?.['anim-emotes']) ? res.data['anim-emotes'] : [],
        stickers: Array.isArray(res.data?.stickers) ? res.data.stickers : [],
        'anim-stickers': Array.isArray(res.data?.['anim-stickers']) ? res.data['anim-stickers'] : [],
      };
      setPersonalManifest(manifest);
    } catch {
      setPersonalManifest(null);
    }
  }, [user?.accountType, token]);

  const clearExpressionServerState = useCallback((url: string) => {
    setExpressionStateByServer((prev) => {
      const next = { ...prev };
      delete next[url];
      return next;
    });
  }, []);

  // --- Compose bridge hooks ---
  const {
    effectiveSelectedServerUrl,
    selectedServer,
    selectedServerState,
    selectServer: selectExpressionPickerServer,
    primePickerSelection: primeExpressionPickerSelection,
    retrySelectedServer: retrySelectedExpressionServer,
  } = useExpressionPickerAdapter<PickerServer, ExpressionManifest>({
    visibleServers: visibleExpressionServers,
    selectedServerUrl: selectedExpressionServerUrl,
    setSelectedServerUrl: setSelectedExpressionServerUrl,
    stateByServer: expressionStateByServer,
    loadManifest,
    ensurePersonalManifest: loadPersonalManifest,
    clearServerState: clearExpressionServerState,
  });

  const composerPickerActions = useComposerExpressionPickerActions({
    pickerTab,
    setPickerTab,
    setPickerOpen,
    primePickerSelection: primeExpressionPickerSelection,
    beforeToggle: onClearReactionPicker ? () => onClearReactionPicker() : undefined,
  });

  const {
    selectedManifest,
    selectedIsExternal,
    canUseSelectedEmojiServer,
    canUseSelectedStickerServer,
    filteredSelectedEmoteItems,
    filteredSelectedStickerItems,
  } = useExpressionPickerDataAdapter<PickerServer, ExpressionItem, ExpressionManifest, PickerExpressionItem>({
    selectedServer,
    selectedServerState,
    personalManifest,
    emptyManifest: EMPTY_MANIFEST,
    currentServerUrl,
    serverUrl,
    authBase: AUTH_BASE,
    canUseExternalEmojis,
    canUseExternalStickers,
    searchQuery: emojiSearchQuery,
    buildPickerItem: ({ expression, sourceUrl, kind, isPersonal }) => ({
      expression,
      sourceUrl,
      key: `${isPersonal ? 'personal' : 'server'}-${kind}-${expression.id}`,
      isPersonal,
    }),
  });

  // --- Default emoji entries ---
  const searchableDefaultEmojiEntries = useMemo(
    () =>
      DEFAULT_EMOJI_CATEGORIES.flatMap((category) =>
        category.emojis.map((emoji, index) => {
          const metadata = emojiMetadataLookup?.get(emoji) ?? emojiMetadataLookup?.get(normalizeEmojiGlyph(emoji));
          const label = (metadata?.label ?? '').toLowerCase();
          const alias = label
            .replace(/[^a-z0-9\s]/g, ' ')
            .trim()
            .replace(/\s+/g, '_')
            .replace(/^_+|_+$/g, '') || `emoji_${index}`;
          const keywords = [
            category.name.toLowerCase(),
            ...DEFAULT_CATEGORY_SEARCH_KEYWORDS[category.name],
            metadata?.label ?? '',
            ...(metadata?.tags ?? []),
          ];
          return {
            key: `${category.name}-${index}-${emoji}`,
            emoji,
            alias,
            category: category.name,
            searchIndex: normalizeEmojiSearchText(keywords.join(' ')),
          };
        })
      ),
    [emojiMetadataLookup]
  );

  const {
    hasEmojiSearchQuery,
    filteredEntries: defaultEmojiEntries,
  } = useDefaultEmojiSearchAdapter({
    searchQuery: emojiSearchQuery,
    selectedCategory: defaultEmojiCategory,
    entries: searchableDefaultEmojiEntries,
    toSearchTerms: toEmojiSearchTerms,
  });

  const defaultEmojiTypeaheadEntries = useMemo(
    () => searchableDefaultEmojiEntries.filter((entry) => entry.alias.length > 0),
    [searchableDefaultEmojiEntries]
  );

  // --- Auto-load current server manifest ---
  useEffect(() => {
    if (!currentExpressionServer || currentExpressionServer.isDefault) return;
    const state = expressionStateByServer[currentExpressionServer.url];
    if (state?.loading || state?.data || state?.error) return;
    void loadManifest(currentExpressionServer);
  }, [currentExpressionServer, expressionStateByServer, loadManifest]);

  // --- Auto-load personal manifest ---
  useEffect(() => {
    void loadPersonalManifest();
  }, [loadPersonalManifest]);

  // --- Auto-load emoji metadata ---
  useEffect(() => {
    void loadEmojiMetadataLookup()
      .then((lookup) => setEmojiMetadataLookup(lookup))
      .catch(() => {});
  }, []);

  return {
    // Picker UI state
    pickerOpen,
    setPickerOpen,
    pickerTab,
    setPickerTab,
    emojiSearchQuery,
    setEmojiSearchQuery,
    defaultEmojiCategory,
    setDefaultEmojiCategory,

    // Expression server list
    visibleExpressionServers,
    currentExpressionServer,
    effectiveSelectedServerUrl,
    selectedServer,
    selectedServerState,
    selectExpressionPickerServer,
    retrySelectedExpressionServer,

    // Manifest data
    selectedManifest,
    selectedIsExternal,
    canUseSelectedEmojiServer,
    canUseSelectedStickerServer,
    filteredSelectedEmoteItems,
    filteredSelectedStickerItems,
    personalManifest,
    personalEmoteItems,
    currentServerEmoteItems,

    // Default emoji
    searchableDefaultEmojiEntries,
    defaultEmojiEntries,
    defaultEmojiTypeaheadEntries,
    hasEmojiSearchQuery,
    emojiMetadataLookup,

    // Composer picker actions
    composerPickerActions,

    // Manifest loading
    loadManifest,
    loadPersonalManifest,

    // Expression state
    expressionStateByServer,
  };
}

export type ExpressionPickerViewModel = ReturnType<typeof useExpressionPickerViewModel>;
