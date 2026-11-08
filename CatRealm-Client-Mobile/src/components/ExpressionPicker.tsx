/**
 * ExpressionPicker — emoji, realm and personal emotes, stickers and GIFs, in the
 * desktop-style floating panel (ExpressionPanel). Opened from MobileComposer's
 * smile button, which it opens above, and from the message menu for reactions,
 * where it is centred. This owns the data, grouping, tokens and usage counts.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';
import { useServerStore } from '@/stores/serverStore';
import { searchEmoji } from '@/lib/emojiSearch';
import { buildServerListItems } from '@/lib/serverListItems';
import { ExpressionPanel, type PanelAnchor, type PanelSource } from './ExpressionPanel';
import {
  getOrigin,
  normalizeExprName,
  type ExpressionEntry,
  type ExpressionLookup,
} from '@/lib/expressionCache';

// ─── Common emoji categories ──────────────────────────────────────────────────

const EMOJI_CATEGORIES: { labelKey: string; items: string[] }[] = [
  {
    labelKey: 'chat.emojiSmileys',
    items: ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩','😘','😗','😚','😙','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🤐','🤨','😐','😑','😶','😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🥵','🥶','🥴','😵','🤯','🤠','🥳','😎','🤓','🧐','😕','😟','🙁','☹️','😮','😯','😲','😳','🥺','😦','😧','😨','😰','😥','😢','😭','😱','😖','😣','😞','😓','😩','😫','🥱','😤','😡','😠','🤬','😈','👿','💀','☠️','💩','🤡','👹','👺','👻','👽','👾','🤖'],
  },
  {
    labelKey: 'chat.emojiGestures',
    items: ['👋','🤚','🖐️','✋','🖖','👌','🤌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏','✍️','💅','🤳','💪','🦾','🦿','🦵','🦶','👂','🦻','👃','🫀','🫁','🧠','🦷','🦴','👀','👁️','👅','👄'],
  },
  {
    labelKey: 'chat.emojiPeople',
    items: ['👶','🧒','👦','👧','🧑','👱','👨','🧔','👩','🧓','👴','👵','🙍','🙎','🙅','🙆','💁','🙋','🧏','🙇','🤦','🤷','💆','💇','🚶','🧍','🧎','🏃','💃','🕺','👫','👬','👭','🤰','🤱','👼','🎅','🤶','🦸','🦹','🧙','🧝','🧛','🧟','🧞','🧜','🧚','👮','🕵️','💂','🥷','👷','🫅','🤴','👸','👳','👲','🧕','🤵','👰','🤰'],
  },
  {
    labelKey: 'chat.emojiAnimals',
    items: ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🙈','🙉','🙊','🐒','🐔','🐧','🐦','🐤','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🪱','🐛','🦋','🐌','🐞','🐜','🪲','🦟','🦗','🪳','🦂','🐢','🐍','🦎','🦖','🦕','🐙','🦑','🦐','🦞','🦀','🪸','🐡','🐠','🐟','🐬','🐳','🐋','🦈','🦭','🐊','🐅','🐆','🦓','🦍','🦧','🦣','🐘','🦛','🦏','🐪','🐫','🦒','🦘','🦬','🐃','🐂','🐄','🐎','🐖','🐏','🐑','🦙','🐐','🦌','🐕','🐩','🦮','🐕‍🦺','🐈','🐈‍⬛','🐓','🦃','🦤','🦚','🦜','🦢','🦩','🕊️','🐇','🦝','🦨','🦡','🦫','🦦','🦥','🐁','🐀','🐿️','🦔'],
  },
  {
    labelKey: 'chat.emojiFood',
    items: ['🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍈','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🍆','🥑','🥦','🥬','🥒','🌶️','🫑','🧄','🧅','🥔','🍠','🥐','🥯','🍞','🥖','🥨','🧀','🥚','🍳','🧈','🥞','🧇','🥓','🥩','🍗','🍖','🦴','🌭','🍔','🍟','🍕','🫓','🥪','🥙','🧆','🌮','🌯','🫔','🥗','🥘','🫕','🥫','🍝','🍜','🍲','🍛','🍣','🍱','🥟','🦪','🍤','🍙','🍚','🍘','🍥','🥮','🍢','🧁','🍰','🎂','🍮','🍭','🍬','🍫','🍿','🍩','🍪','🌰','🥜','🍯','🧃','🥤','🧋','🍵','☕','🫖','🍺','🍷','🥃','🍸','🍹','🧉','🍾'],
  },
  {
    labelKey: 'chat.emojiTravel',
    items: ['🚗','🚕','🚙','🚌','🚎','🏎️','🚓','🚑','🚒','🚐','🛻','🚚','🚛','🚜','🦯','🦽','🦼','🛴','🚲','🛵','🏍️','🛺','🚨','🚔','🚍','🚘','🚖','🛞','🚡','🚠','🚟','🚃','🚋','🚞','🚝','🚄','🚅','🚈','🚂','🚆','🚇','🚊','🚉','✈️','🛫','🛬','🛩️','💺','🚁','🚟','🛸','🚀','🛷','🛶','⛵','🚤','🛥️','🛳️','⛴️','🚢','⚓','🪝','⛽','🛞','🚧','🚦','🚥','🗺️','🗿','🗽','🗼','🏰','🏯','🏟️','🎡','🎢','🎠','⛲','⛱️','🏖️','🏝️','🏜️','🏕️','⛺','🌁','🏙️','🌃','🌄','🌅','🌆','🌇','🌉','🌌','🎇','🎆'],
  },
  {
    labelKey: 'chat.emojiObjects',
    items: ['⌚','📱','💻','⌨️','🖥️','🖨️','🖱️','🖲️','💽','💾','💿','📀','📷','📸','📹','🎥','📽️','🎞️','📞','☎️','📟','📠','📺','📻','🧭','⏱️','⏲️','⏰','🕰️','⌛','⏳','📡','🔋','🪫','🔌','💡','🔦','🕯️','🪔','🧯','🛢️','💸','💵','💴','💶','💷','🪙','💰','💳','💎','⚖️','🪜','🧰','🪛','🔧','🔨','⚒️','🛠️','⛏️','🪚','🔩','🪤','🧲','🔫','💣','🪓','🔪','🗡️','⚔️','🛡️','🪃','🏹','🪄','🔮','🪬','🧿','💈','⚗️','🔭','🔬','🩻','🩹','💊','💉','🩸','🩺','🩼','🪤','🧪','🧫','🧬'],
  },
  {
    labelKey: 'chat.emojiSymbols',
    items: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❤️‍🔥','❤️‍🩹','💖','💗','💓','💞','💕','💟','❣️','💝','💘','💌','💋','💯','💢','💥','💫','💦','💨','🕳️','💬','💭','🗯️','💤','🔔','🔕','🎵','🎶','🎼','🎤','🎧','📣','📢','🔊','🔉','🔈','🔇','🔔','💹','📈','📉','♾️','✅','❎','🔀','🔁','🔂','▶️','⏸️','⏹️','⏺️','🔆','🔅','📶','📳','📴','🚫','⛔','🚳','🚭','🚯','🚱','🚷','📵','🔞','☢️','☣️','↩️','↪️','⤴️','⤵️','♻️','✔️','❌','❓','❗','‼️','🔴','🟠','🟡','🟢','🔵','🟣','⚫','⚪','🟤'],
  },
];

// ─── Types ────────────────────────────────────────────────────────────────────

type ExpressionKind = 'emote' | 'sticker';

interface ExpressionPickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (
    displayToken: string,
    serializedToken?: string,
    preview?: { name: string; url: string; isSticker: boolean },
  ) => void;
  expressionLookup?: ExpressionLookup | null;
  serverUrl?: string | null;
  canLoadExpressions?: boolean;
  /** Cat Lab GIF picker: enables the GIFs tab and sends the chosen GIF URL. */
  gifPickerEnabled?: boolean;
  onSelectGif?: (gifUrl: string) => void;
  /** The picker button's window frame, so the panel opens above it; centred without one. */
  anchor?: PanelAnchor | null;
}

const ALL_EMOJI = [...new Set(EMOJI_CATEGORIES.flatMap((category) => category.items))];
const USAGE_STORAGE_KEY = 'catrealm.expression-usage.v1';
/** The Most used entry: two rows of the seven-wide emote grid. */
const MOST_USED_LIMIT = 14;

// ─── Component ────────────────────────────────────────────────────────────────

export function ExpressionPicker({
  open,
  onClose,
  onSelect,
  expressionLookup,
  serverUrl,
  canLoadExpressions = false,
  gifPickerEnabled = false,
  onSelectGif,
  anchor,
}: ExpressionPickerProps) {
  const { t: tr } = useTranslation();
  const [emojiCat, setEmojiCat] = useState(0);
  const [usage, setUsage] = useState<Record<string, number>>({});
  const [query, setQuery] = useState('');
  useEffect(() => { if (!open) setQuery(''); }, [open]);
  const searchTerm = query.trim().toLowerCase();
  const servers = useServerStore((s) => s.servers);
  const serverLayout = useServerStore((s) => s.serverLayout);
  const serverFolders = useServerStore((s) => s.serverFolders);

  const emoteEntries = useMemo(() => {
    if (!expressionLookup) return [];
    return [...expressionLookup.values()].filter(e => e.emote && e.name.toLowerCase().includes(searchTerm));
  }, [expressionLookup, searchTerm]);

  const stickerEntries = useMemo(() => {
    if (!expressionLookup) return [];
    return [...expressionLookup.values()].filter(e => e.sticker && e.name.toLowerCase().includes(searchTerm));
  }, [expressionLookup, searchTerm]);
  const emojiResults = useMemo(
    () => (searchTerm ? searchEmoji(ALL_EMOJI, searchTerm) : EMOJI_CATEGORIES[emojiCat]?.items ?? []),
    [emojiCat, searchTerm],
  );

  const hasServer = Boolean(serverUrl && getOrigin(serverUrl));
  const isLoadingExpressions = (hasServer || canLoadExpressions) && expressionLookup == null;
  const currentOrigin = serverUrl ? getOrigin(serverUrl) : null;

  const serverNameByOrigin = useMemo(() => {
    const names = new Map<string, string>();
    for (const server of servers) {
      const origin = getOrigin(server.url);
      if (origin) names.set(origin, server.name);
    }
    return names;
  }, [servers]);

  useEffect(() => {
    let cancelled = false;
    void AsyncStorage.getItem(USAGE_STORAGE_KEY).then((raw) => {
      if (cancelled || !raw) return;
      try {
        const parsed = JSON.parse(raw) as Record<string, number>;
        setUsage(parsed);
      } catch {
        setUsage({});
      }
    });
    return () => { cancelled = true; };
  }, []);

  const usageKeyFor = useCallback((item: ExpressionEntry, kind: ExpressionKind) => [
    kind,
    item.source ?? 'server',
    item.origin ?? '',
    item.ownerId ?? '',
    normalizeExprName(item.name),
  ].join(':'), []);

  const recordUsage = useCallback((item: ExpressionEntry, kind: ExpressionKind) => {
    const key = usageKeyFor(item, kind);
    setUsage((prev) => {
      const next = { ...prev, [key]: (prev[key] ?? 0) + 1 };
      void AsyncStorage.setItem(USAGE_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, [usageKeyFor]);

  const labelForOrigin = useCallback((origin?: string | null) => {
    if (!origin) return tr('chat.realmLabel');
    const name = serverNameByOrigin.get(origin);
    if (name) return name;
    try { return new globalThis.URL(origin).hostname; } catch { return tr('chat.realmLabel'); }
  }, [serverNameByOrigin, tr]);

  const sectionKeyFor = useCallback((item: ExpressionEntry) => {
    if (item.source === 'personal') return 'personal';
    return getOrigin(item.origin ?? '') ?? 'unknown';
  }, []);

  // Realms are listed exactly as the realm list orders them, folders included.
  const railRankByOrigin = useMemo(() => {
    const ranks = new Map<string, number>();
    const items = buildServerListItems(servers, serverLayout ?? [], serverFolders ?? []);
    for (const item of items) {
      for (const server of item.type === 'server' ? [item.server] : item.servers) {
        const origin = getOrigin(server.url);
        if (origin && !ranks.has(origin)) ranks.set(origin, ranks.size);
      }
    }
    return ranks;
  }, [serverFolders, serverLayout, servers]);
  const railSortRank = useCallback((key: string) => {
    if (key === 'personal') return -1;
    return railRankByOrigin.get(key) ?? 999;
  }, [railRankByOrigin]);

  /** One source's expressions, whole: Most used, Personal, then each realm. */
  const buildSources = useCallback((entries: ExpressionEntry[], kind: ExpressionKind): PanelSource[] => {
    const sortedEntries = [...entries].sort((a, b) => a.name.localeCompare(b.name));
    const mostUsed = sortedEntries
      .filter((entry) => (usage[usageKeyFor(entry, kind)] ?? 0) > 0)
      .sort((a, b) => (usage[usageKeyFor(b, kind)] ?? 0) - (usage[usageKeyFor(a, kind)] ?? 0))
      .slice(0, MOST_USED_LIMIT);

    const grouped = new Map<string, ExpressionEntry[]>();
    for (const entry of sortedEntries) {
      const key = sectionKeyFor(entry);
      const list = grouped.get(key) ?? [];
      list.push(entry);
      grouped.set(key, list);
    }

    const sources: PanelSource[] = [];
    if (mostUsed.length > 0) {
      sources.push({
        key: `most-${kind}`,
        title: kind === 'sticker' ? tr('chat.mostUsedStickers') : tr('chat.mostUsedEmotes'),
        kind: 'most',
        entries: mostUsed,
      });
    }

    for (const [key, values] of [...grouped.entries()].sort((a, b) => railSortRank(a[0]) - railSortRank(b[0]))) {
      const server = servers.find((candidate) => getOrigin(candidate.url) === key);
      sources.push({
        key: `${kind}-${key}`,
        title: key === 'personal' ? tr('chat.personal') : key === 'unknown' ? tr('chat.realmLabel') : labelForOrigin(key),
        kind: key === 'personal' ? 'personal' : 'realm',
        iconUrl: server?.iconUrl ?? null,
        realmUrl: server?.url ?? null,
        entries: values,
      });
    }
    return sources;
  }, [labelForOrigin, railSortRank, sectionKeyFor, servers, tr, usage, usageKeyFor]);

  const emoteSources = useMemo(() => buildSources(emoteEntries, 'emote'), [buildSources, emoteEntries]);
  const stickerSources = useMemo(() => buildSources(stickerEntries, 'sticker'), [buildSources, stickerEntries]);

  const buildToken = useCallback((item: ExpressionEntry, kind: ExpressionKind) => {
    const prefix = kind === 'sticker' ? 'sticker:' : '';
    const origin = item.origin ? getOrigin(item.origin) : null;
    const ownerId = item.ownerId?.toLowerCase().replace(/[^a-z0-9_-]/g, '') ?? '';
    const includeOrigin = origin && origin !== currentOrigin;
    const name = normalizeExprName(item.name);

    if (includeOrigin) {
      return ownerId
        ? `:${origin}:${prefix}${name}:${ownerId}:`
        : `:${origin}:${prefix}${name}:`;
    }
    return ownerId ? `:${prefix}${name}:${ownerId}:` : `:${prefix}${name}:`;
  }, [currentOrigin]);

  const buildDisplayToken = useCallback((item: ExpressionEntry, kind: ExpressionKind) => {
    const prefix = kind === 'sticker' ? 'sticker:' : '';
    return `:${prefix}${normalizeExprName(item.name)}:`;
  }, []);

  const selectExpression = useCallback((item: ExpressionEntry, kind: ExpressionKind) => {
    recordUsage(item, kind);
    const url = kind === 'sticker' ? item.sticker : item.emote;
    onSelect(
      buildDisplayToken(item, kind),
      buildToken(item, kind),
      url ? { name: item.name, url, isSticker: kind === 'sticker' } : undefined,
    );
    onClose();
  }, [buildDisplayToken, buildToken, onClose, onSelect, recordUsage]);

  return (
    <ExpressionPanel
      open={open}
      onClose={onClose}
      anchor={anchor}
      query={query}
      onQueryChange={setQuery}
      emojiCategories={EMOJI_CATEGORIES.map((category) => tr(category.labelKey))}
      emojiCategory={emojiCat}
      onEmojiCategoryChange={setEmojiCat}
      emojiResults={emojiResults}
      onSelectEmoji={(emoji: string) => { onSelect(emoji); onClose(); }}
      emoteSources={emoteSources}
      stickerSources={stickerSources}
      onSelectExpression={selectExpression}
      loading={isLoadingExpressions}
      emptyEmotesText={!hasServer ? (canLoadExpressions ? tr('chat.noEmotesAvailable') : tr('chat.noServer')) : tr('chat.noEmotesOnServer')}
      emptyStickersText={!hasServer ? (canLoadExpressions ? tr('chat.noStickersAvailable') : tr('chat.noServer')) : tr('chat.noStickersOnServer')}
      onSelectGif={gifPickerEnabled && onSelectGif ? (url: string) => { onSelectGif(url); onClose(); } : undefined}
      // Open on the realm being chatted in, as desktop does.
      currentRealmOrigin={currentOrigin}
    />
  );
}
