/**
 * ExpressionPicker — bottom sheet for picking emoji, server emotes, and stickers.
 * Opened from MobileComposer when the user taps the smile icon.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Image,
  FlatList,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  ActivityIndicator,
  TextInput,
  useWindowDimensions,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme';
import { useServerStore } from '@/stores/serverStore';
import { Sheet } from './Sheet';
import { GifPickerTab } from './GifPickerTab';
import { searchEmoji } from '@/lib/emojiSearch';
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

type Tab = 'emoji' | 'emotes' | 'stickers' | 'gifs';
type ExpressionKind = 'emote' | 'sticker';

type PickerSection = {
  key: string;
  title: string;
  data: ExpressionEntry[][];
};

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
}

const ALL_EMOJI = [...new Set(EMOJI_CATEGORIES.flatMap((category) => category.items))];
/** Tablets get a centred panel; a full-width sheet spreads 8 columns ~150pt apart. */
const PICKER_MAX_WIDTH = 560;
const GRID_PADDING = 8;
const MIN_CELL = 44;
const MIN_STICKER_CELL = 90;
const STICKER_MARGIN = 4;
const USAGE_STORAGE_KEY = 'catrealm.expression-usage.v1';

function chunkEntries(entries: ExpressionEntry[], size: number): ExpressionEntry[][] {
  const rows: ExpressionEntry[][] = [];
  for (let i = 0; i < entries.length; i += size) rows.push(entries.slice(i, i + size));
  return rows;
}

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
}: ExpressionPickerProps) {
  const theme = useTheme();
  const { t: tr } = useTranslation();
  const [tab, setTab] = useState<Tab>('emoji');
  const [emojiCat, setEmojiCat] = useState(0);
  const [usage, setUsage] = useState<Record<string, number>>({});
  const [query, setQuery] = useState('');
  useEffect(() => { if (!open) setQuery(''); }, [open]);
  const searchTerm = query.trim().toLowerCase();
  const { width: windowWidth } = useWindowDimensions();
  const pickerWidth = Math.min(windowWidth, PICKER_MAX_WIDTH);
  const gridWidth = pickerWidth - GRID_PADDING * 2;
  const numCols = Math.max(8, Math.floor(gridWidth / MIN_CELL));
  const cell = gridWidth / numCols;
  const stickerCols = Math.max(4, Math.floor(gridWidth / MIN_STICKER_CELL));
  const stickerCell = gridWidth / stickerCols - STICKER_MARGIN * 2;
  const servers = useServerStore((s) => s.servers);
  const activeServerId = useServerStore((s) => s.activeServerId);

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
  const activeServerOrigin = useMemo(
    () => getOrigin(servers.find((server) => server.id === activeServerId)?.url ?? serverUrl ?? ''),
    [activeServerId, serverUrl, servers],
  );

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

  const sectionTitleFor = useCallback((key: string) => {
    if (key === 'personal') return tr('chat.personal');
    if (key === 'unknown') return tr('chat.realmLabel');
    const label = labelForOrigin(key);
    return /^realm\b/i.test(label) ? label : `${tr('chat.realmLabel')} ${label}`;
  }, [labelForOrigin, tr]);

  const sourceSortRank = useCallback((key: string) => {
    if (key === 'personal') return -2;
    if (activeServerOrigin && key === activeServerOrigin) return -1;
    const index = servers.findIndex((server) => getOrigin(server.url) === key);
    return index === -1 ? 999 : index;
  }, [activeServerOrigin, servers]);

  const buildSections = useCallback((entries: ExpressionEntry[], kind: ExpressionKind): PickerSection[] => {
    const cols = kind === 'sticker' ? stickerCols : numCols;
    const sortedEntries = [...entries].sort((a, b) => a.name.localeCompare(b.name));
    const mostUsed = sortedEntries
      .filter((entry) => (usage[usageKeyFor(entry, kind)] ?? 0) > 0)
      .sort((a, b) => (usage[usageKeyFor(b, kind)] ?? 0) - (usage[usageKeyFor(a, kind)] ?? 0))
      .slice(0, cols * 2);

    const grouped = new Map<string, ExpressionEntry[]>();
    for (const entry of sortedEntries) {
      const key = sectionKeyFor(entry);
      const list = grouped.get(key) ?? [];
      list.push(entry);
      grouped.set(key, list);
    }

    const sections: PickerSection[] = [];
    if (mostUsed.length > 0) {
      sections.push({
        key: `most-${kind}`,
        title: kind === 'sticker' ? tr('chat.mostUsedStickers') : tr('chat.mostUsedEmotes'),
        data: chunkEntries(mostUsed, cols),
      });
    }

    for (const [key, values] of [...grouped.entries()].sort((a, b) => sourceSortRank(a[0]) - sourceSortRank(b[0]))) {
      sections.push({
        key: `${kind}-${key}`,
        title: sectionTitleFor(key),
        data: chunkEntries(values, cols),
      });
    }
    return sections;
  }, [numCols, sectionKeyFor, sectionTitleFor, sourceSortRank, stickerCols, tr, usage, usageKeyFor]);

  const emoteSections = useMemo(
    () => buildSections(emoteEntries, 'emote'),
    [buildSections, emoteEntries],
  );
  const stickerSections = useMemo(
    () => buildSections(stickerEntries, 'sticker'),
    [buildSections, stickerEntries],
  );

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

  const tabStyle = (active: boolean) => [
    styles.tab,
    { borderBottomColor: active ? theme.colors.accent : 'transparent' },
  ];

  return (
    <Sheet open={open} onClose={onClose} maxHeightFraction={0.55} maxWidth={PICKER_MAX_WIDTH} avoidKeyboard>
      {/* Tab bar */}
      <View style={[styles.tabBar, { borderBottomColor: theme.colors.lineSoft }]}>
        {((gifPickerEnabled && onSelectGif
          ? ['emoji', 'emotes', 'stickers', 'gifs']
          : ['emoji', 'emotes', 'stickers']) as Tab[]).map(t => (
          <Pressable key={t} style={tabStyle(tab === t)} onPress={() => setTab(t)}>
            <Text style={{ color: tab === t ? theme.colors.accent : theme.colors.text3, fontSize: 13, fontWeight: '600' }}>
              {t === 'emoji' ? tr('chat.emojiTab')
                : t === 'emotes' ? tr('chat.emotesTab')
                : t === 'stickers' ? tr('chat.stickersTab')
                : tr('chat.gifsTab')}
            </Text>
          </Pressable>
        ))}
      </View>

      {tab !== 'gifs' && (
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={tr('chat.searchExpressions')}
          placeholderTextColor={theme.colors.text3}
          accessibilityLabel={tr('chat.searchExpressions')}
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="while-editing"
          returnKeyType="search"
          style={[styles.search, { backgroundColor: theme.colors.bgElev2, color: theme.colors.text, borderColor: theme.colors.lineSoft }]}
        />
      )}

      {/* Emoji tab */}
      {tab === 'emoji' && (
        <View style={{ flex: 1 }}>
          {/* Category strip (hidden while searching every category) */}
          {!searchTerm && <FlatList
            horizontal
            showsHorizontalScrollIndicator={false}
            data={EMOJI_CATEGORIES}
            keyExtractor={(_, i) => String(i)}
            contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 6, gap: 8 }}
            renderItem={({ item, index }) => (
              <Pressable
                onPress={() => setEmojiCat(index)}
                style={[
                  styles.catChip,
                  {
                    backgroundColor: emojiCat === index ? theme.colors.accent : theme.colors.bgElev2,
                  },
                ]}
              >
                <Text style={{ fontSize: 12, color: emojiCat === index ? theme.colors.textOnAccent : theme.colors.text }}>
                  {tr(item.labelKey)}
                </Text>
              </Pressable>
            )}
          />}
          <FlatList
            key={numCols}
            data={emojiResults}
            keyExtractor={(item) => item}
            numColumns={numCols}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingHorizontal: GRID_PADDING, paddingBottom: 8 }}
            ListEmptyComponent={<Text style={[styles.empty, { color: theme.colors.text3 }]}>{tr('chat.noResultsFound')}</Text>}
            renderItem={({ item }) => (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={item}
                style={[styles.cell, { width: cell, height: cell }]}
                onPress={() => { onSelect(item); onClose(); }}
              >
                <Text style={{ fontSize: 28 }}>{item}</Text>
              </Pressable>
            )}
          />
        </View>
      )}

      {/* GIFs tab (Cat Lab) — Klipy-backed, central-proxied Tenor replacement */}
      {tab === 'gifs' && onSelectGif && (
        <GifPickerTab width={pickerWidth} onSelect={(url) => { onSelectGif(url); onClose(); }} />
      )}

      {/* Emotes tab */}
      {tab === 'emotes' && (
        emoteSections.length > 0 ? (
          <SectionList
            sections={emoteSections}
            keyExtractor={(row, index) => `${row.map((e) => usageKeyFor(e, 'emote')).join('|')}:${index}`}
            stickySectionHeadersEnabled
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.expressionList}
            renderSectionHeader={({ section }) => (
              <View style={[styles.sectionHeader, { backgroundColor: theme.colors.bgElev1 }]}>
                <Text style={[styles.sectionTitle, { color: theme.colors.text3 }]}>{section.title}</Text>
              </View>
            )}
            renderItem={({ item: row }) => (
              <View style={styles.expressionRow}>
                {row.map((item) => (
                  <Pressable
                    key={usageKeyFor(item, 'emote')}
                    style={[styles.cell, { width: cell, height: cell }]}
                    onPress={() => selectExpression(item, 'emote')}
                  >
                    <Image
                      source={{ uri: item.emote }}
                      style={{ width: cell - 12, height: cell - 12 }}
                      resizeMode="contain"
                    />
                  </Pressable>
                ))}
              </View>
            )}
          />
        ) : searchTerm ? (
          <Text style={[styles.empty, { color: theme.colors.text3 }]}>{tr('chat.noResultsFound')}</Text>
        ) : isLoadingExpressions ? (
          <View style={styles.center}>
            <ActivityIndicator color={theme.colors.accent} />
          </View>
        ) : !hasServer ? (
          <View style={styles.center}>
            <Text style={{ color: theme.colors.text3 }}>
              {canLoadExpressions ? tr('chat.noEmotesAvailable') : tr('chat.noServer')}
            </Text>
          </View>
        ) : (
          <View style={styles.center}>
            <Text style={{ color: theme.colors.text3 }}>{tr('chat.noEmotesOnServer')}</Text>
          </View>
        )
      )}

      {/* Stickers tab */}
      {tab === 'stickers' && (
        stickerSections.length > 0 ? (
          <SectionList
            sections={stickerSections}
            keyExtractor={(row, index) => `${row.map((e) => usageKeyFor(e, 'sticker')).join('|')}:${index}`}
            stickySectionHeadersEnabled
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.expressionList}
            renderSectionHeader={({ section }) => (
              <View style={[styles.sectionHeader, { backgroundColor: theme.colors.bgElev1 }]}>
                <Text style={[styles.sectionTitle, { color: theme.colors.text3 }]}>{section.title}</Text>
              </View>
            )}
            renderItem={({ item: row }) => (
              <View style={styles.expressionRow}>
                {row.map((item) => (
                  <Pressable
                    key={usageKeyFor(item, 'sticker')}
                    style={[styles.stickerCell, { width: stickerCell, height: stickerCell }]}
                    onPress={() => selectExpression(item, 'sticker')}
                  >
                    <Image
                      source={{ uri: item.sticker }}
                      style={{ width: stickerCell - 16, height: stickerCell - 16 }}
                      resizeMode="contain"
                    />
                  </Pressable>
                ))}
              </View>
            )}
          />
        ) : searchTerm ? (
          <Text style={[styles.empty, { color: theme.colors.text3 }]}>{tr('chat.noResultsFound')}</Text>
        ) : isLoadingExpressions ? (
          <View style={styles.center}>
            <ActivityIndicator color={theme.colors.accent} />
          </View>
        ) : !hasServer ? (
          <View style={styles.center}>
            <Text style={{ color: theme.colors.text3 }}>
              {canLoadExpressions ? tr('chat.noStickersAvailable') : tr('chat.noServer')}
            </Text>
          </View>
        ) : (
          <View style={styles.center}>
            <Text style={{ color: theme.colors.text3 }}>{tr('chat.noStickersOnServer')}</Text>
          </View>
        )
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    paddingHorizontal: 16,
  },
  tab: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 2,
    marginBottom: -1,
  },
  cell: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  expressionList: {
    paddingHorizontal: 8,
    paddingBottom: 8,
  },
  expressionRow: {
    flexDirection: 'row',
  },
  sectionHeader: {
    paddingHorizontal: 8,
    paddingTop: 10,
    paddingBottom: 6,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  stickerCell: {
    alignItems: 'center',
    justifyContent: 'center',
    margin: STICKER_MARGIN,
  },
  search: {
    marginHorizontal: 12,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    fontSize: 14,
  },
  empty: {
    padding: 24,
    textAlign: 'center',
  },
  catChip: {
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
});
