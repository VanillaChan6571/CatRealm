/**
 * Expression picker panel, laid out like desktop's (SharedExpressionPickerPanel):
 * a floating panel above the composer's picker button with Emojis / Stickers /
 * GIFs tabs, search and Close along the top, the sources (personal, each realm,
 * default emoji) down the left, and the chosen source's grid on the right.
 * Phones get the compact form: full width, an icon-only source column, search
 * on its own row and fewer columns. ExpressionPicker owns the data; this only
 * lays it out.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Image,
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Clock } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/theme';
import type { ExpressionEntry } from '@/lib/expressionCache';
import { OverlayPortal } from './OverlayPortal';
import { ServerIcon } from './ServerIcon';
import { GifPickerTab } from './GifPickerTab';

export type PanelAnchor = { x: number; y: number; width: number; height: number };

export type PanelSource = {
  key: string;
  title: string;
  /** 'most' draws a clock, 'personal' a P, 'realm' the realm's icon. */
  kind: 'most' | 'personal' | 'realm';
  iconUrl?: string | null;
  /** The realm's address, which a relative icon path resolves against. */
  realmUrl?: string | null;
  entries: ExpressionEntry[];
};

type PanelTab = 'emojis' | 'stickers' | 'gifs';

const PANEL_WIDTH = 540;
const BODY_HEIGHT = 340;
const SIDEBAR_WIDTH = 140;
/** Phones: an icon-only source column. */
const COMPACT_SIDEBAR_WIDTH = 56;
/** Narrower than this, the panel takes the compact (phone) layout. */
const COMPACT_MAX_WIDTH = 600;
const COMPACT_GUTTER = 8;
const GRID_PADDING = 10;
const PANEL_GAP = 8;
const EDGE_GUTTER = 12;
const EMOJI_COLUMNS = 8;
const EMOTE_COLUMNS = 7;
const COMPACT_EMOJI_COLUMNS = 7;
const COMPACT_EMOTE_COLUMNS = 6;
/** Header height: one row, or two when compact (search below the tabs). */
const HEADER_HEIGHT = 48;
const COMPACT_HEADER_HEIGHT = 90;
const MIN_BODY_HEIGHT = 160;
const STICKER_COLUMNS = 3;
const DEFAULT_SOURCE = 'default';

/** Keeps the panel on screen, its right edge lined up with the picker button's where possible. */
export function placePanel(
  anchor: PanelAnchor | null | undefined,
  windowWidth: number,
  windowHeight: number,
  width: number,
  gutter = EDGE_GUTTER,
) {
  if (!anchor) return null;
  const left = Math.max(
    gutter,
    Math.min(anchor.x + anchor.width - width, windowWidth - gutter - width),
  );
  const bottom = Math.max(gutter, windowHeight - anchor.y + PANEL_GAP);
  return { left, bottom };
}

export function ExpressionPanel({
  open,
  onClose,
  anchor,
  query,
  onQueryChange,
  emojiCategories,
  emojiCategory,
  onEmojiCategoryChange,
  emojiResults,
  onSelectEmoji,
  emoteSources,
  stickerSources,
  onSelectExpression,
  loading,
  emptyEmotesText,
  emptyStickersText,
  onSelectGif,
  currentRealmOrigin,
}: {
  open: boolean;
  onClose: () => void;
  /** The picker button's window frame; without one the panel is centred. */
  anchor?: PanelAnchor | null;
  query: string;
  onQueryChange: (value: string) => void;
  emojiCategories: string[];
  emojiCategory: number;
  onEmojiCategoryChange: (index: number) => void;
  emojiResults: string[];
  onSelectEmoji: (emoji: string) => void;
  emoteSources: PanelSource[];
  stickerSources: PanelSource[];
  onSelectExpression: (item: ExpressionEntry, kind: 'emote' | 'sticker') => void;
  loading: boolean;
  emptyEmotesText: string;
  emptyStickersText: string;
  onSelectGif?: (url: string) => void;
  /** The realm being chatted in; the panel opens on its expressions when it has any. */
  currentRealmOrigin?: string | null;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [tab, setTab] = useState<PanelTab>('emojis');
  // null until a source is picked: then the panel follows the current realm, which
  // may only appear once its expressions load.
  const [emojiSource, setEmojiSource] = useState<string | null>(null);
  const [stickerSource, setStickerSource] = useState<string | null>(null);
  const appear = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!open) return;
    setEmojiSource(null);
    setStickerSource(null);
    appear.setValue(0);
    Animated.timing(appear, { toValue: 1, duration: 140, useNativeDriver: true }).start();
  }, [open, appear]);

  // Typing in the search box raises the keyboard; lift the panel above it.
  useEffect(() => {
    if (!open) return;
    const show = Keyboard.addListener('keyboardWillShow', (event) =>
      setKeyboardHeight(event.endCoordinates.height),
    );
    const hide = Keyboard.addListener('keyboardWillHide', () => setKeyboardHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, [open]);

  if (!open) return null;

  const compact = windowWidth < COMPACT_MAX_WIDTH;
  const gutter = compact ? COMPACT_GUTTER : EDGE_GUTTER;
  const width = compact
    ? windowWidth - gutter * 2
    : Math.min(PANEL_WIDTH, windowWidth - gutter * 2);
  const sidebarWidth = compact ? COMPACT_SIDEBAR_WIDTH : SIDEBAR_WIDTH;
  const emojiColumns = compact ? COMPACT_EMOJI_COLUMNS : EMOJI_COLUMNS;
  const emoteColumns = compact ? COMPACT_EMOTE_COLUMNS : EMOTE_COLUMNS;
  const anchored = placePanel(anchor, windowWidth, windowHeight, width, gutter);
  const placement = anchored
    ? { ...anchored, bottom: Math.max(anchored.bottom, keyboardHeight + PANEL_GAP) }
    : null;
  const gridWidth = width - sidebarWidth - GRID_PADDING * 2;
  // Fit between the top of the screen and the composer (or keyboard).
  const headerHeight = compact ? COMPACT_HEADER_HEIGHT : HEADER_HEIGHT;
  const roomAbove = placement
    ? windowHeight - placement.bottom - insets.top - gutter - headerHeight
    : windowHeight - keyboardHeight - insets.top - insets.bottom - gutter * 4 - headerHeight;
  const bodyHeight = Math.max(
    MIN_BODY_HEIGHT,
    Math.min(BODY_HEIGHT, windowHeight * 0.45, roomAbove),
  );

  // Open on the current realm's own expressions, else the top of the column. A
  // picked source that drops out (no search matches, realm left) falls back the same way.
  const pickSource = (sources: PanelSource[], picked: string | null, preferred: string | null) =>
    sources.find((source) => source.key === picked) ??
    sources.find((source) => source.key === preferred) ??
    sources[0] ??
    null;
  const activeEmojiSource =
    emojiSource === DEFAULT_SOURCE
      ? DEFAULT_SOURCE
      : (pickSource(
          emoteSources,
          emojiSource,
          currentRealmOrigin ? `emote-${currentRealmOrigin}` : null,
        )?.key ?? DEFAULT_SOURCE);
  const activeStickerSource = pickSource(
    stickerSources,
    stickerSource,
    currentRealmOrigin ? `sticker-${currentRealmOrigin}` : null,
  );
  const activeEmoteSource = emoteSources.find((source) => source.key === activeEmojiSource) ?? null;

  const sourceIcon = (source: PanelSource | null) => {
    if (!source) return <Text style={[styles.sourceGlyph, { color: theme.colors.text2 }]}>★</Text>;
    if (source.kind === 'most') return <Clock size={14} color={theme.colors.text2} />;
    if (source.kind === 'personal')
      return <Text style={[styles.sourceGlyph, { color: theme.colors.text2 }]}>P</Text>;
    return (
      <ServerIcon
        server={{ name: source.title, iconUrl: source.iconUrl, url: source.realmUrl }}
        size={compact ? 28 : 20}
        square
      />
    );
  };

  const sourceRow = (
    key: string,
    title: string,
    icon: ReactNode,
    selected: boolean,
    onPress: () => void,
  ) => (
    <Pressable
      key={key}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={title}
      onPress={onPress}
      style={[
        styles.sourceRow,
        compact && styles.sourceRowCompact,
        { borderRadius: theme.radius.sm },
        selected && { backgroundColor: theme.colors.accent },
      ]}
    >
      <View
        style={[
          styles.sourceIcon,
          compact && styles.sourceIconCompact,
          { backgroundColor: selected ? 'transparent' : theme.colors.bgElev3 },
        ]}
      >
        {icon}
      </View>
      {/* Phones show icons only; the grid heading names the source. */}
      {compact ? null : (
        <Text
          numberOfLines={1}
          style={[
            styles.sourceTitle,
            { color: selected ? theme.colors.textOnAccent : theme.colors.text2 },
          ]}
        >
          {title}
        </Text>
      )}
    </Pressable>
  );

  const heading = (label: string) => (
    <Text style={[styles.heading, { color: theme.colors.text3 }]}>{label}</Text>
  );

  const message = (text: string) => (
    <View style={styles.center}>
      {loading ? (
        <ActivityIndicator color={theme.colors.accent} />
      ) : (
        <Text style={{ color: theme.colors.text3, fontSize: 13 }}>{text}</Text>
      )}
    </View>
  );

  const expressionGrid = (source: PanelSource, kind: 'emote' | 'sticker') => {
    const columns = kind === 'sticker' ? STICKER_COLUMNS : emoteColumns;
    const gap = kind === 'sticker' ? 8 : 6;
    const cell = (gridWidth - gap * (columns - 1)) / columns;
    return (
      <FlatList
        key={`${kind}-${source.key}-${columns}`}
        data={source.entries}
        numColumns={columns}
        keyExtractor={(item, index) =>
          `${item.origin ?? ''}:${item.ownerId ?? ''}:${item.name}:${index}`
        }
        keyboardShouldPersistTaps="handled"
        columnWrapperStyle={{ gap }}
        contentContainerStyle={{ gap, paddingBottom: GRID_PADDING }}
        ListHeaderComponent={heading(source.title)}
        ListEmptyComponent={
          <Text style={[styles.emptyText, { color: theme.colors.text3 }]}>
            {t('chat.noResultsFound')}
          </Text>
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={item.name}
            onPress={() => onSelectExpression(item, kind)}
            style={({ pressed }) => [
              styles.tile,
              {
                width: cell,
                height: kind === 'sticker' ? cell + 18 : cell,
                backgroundColor: theme.colors.bgElev2,
                borderColor: pressed ? theme.colors.accent : theme.colors.lineSoft,
                borderRadius: theme.radius.sm,
              },
            ]}
          >
            <Image
              source={{ uri: kind === 'sticker' ? item.sticker : item.emote }}
              style={
                kind === 'sticker'
                  ? { width: cell - 12, height: cell - 12 }
                  : { width: cell - 14, height: cell - 14 }
              }
              resizeMode="contain"
            />
            {kind === 'sticker' ? (
              <Text numberOfLines={1} style={[styles.stickerName, { color: theme.colors.text3 }]}>
                {item.name}
              </Text>
            ) : null}
          </Pressable>
        )}
      />
    );
  };

  const emojiGrid = () => {
    const gap = 4;
    const cell = (gridWidth - gap * (emojiColumns - 1)) / emojiColumns;
    return (
      <FlatList
        key={`default-emoji-${emojiColumns}`}
        data={emojiResults}
        numColumns={emojiColumns}
        keyExtractor={(item) => item}
        keyboardShouldPersistTaps="handled"
        columnWrapperStyle={{ gap }}
        contentContainerStyle={{ gap, paddingBottom: GRID_PADDING }}
        ListHeaderComponent={
          <View>
            {heading(
              query.trim() ? t('chat.emojiResults') : (emojiCategories[emojiCategory] ?? ''),
            )}
            {!query.trim() ? (
              <View style={styles.chips}>
                {emojiCategories.map((label, index) => {
                  const selected = index === emojiCategory;
                  return (
                    <Pressable
                      key={label}
                      onPress={() => onEmojiCategoryChange(index)}
                      style={[
                        styles.chip,
                        {
                          borderRadius: theme.radius.sm,
                          backgroundColor: selected ? theme.colors.accent : theme.colors.bgElev2,
                          borderColor: selected ? theme.colors.accent : theme.colors.lineSoft,
                        },
                      ]}
                    >
                      <Text
                        style={{
                          fontSize: 11,
                          color: selected ? theme.colors.textOnAccent : theme.colors.text3,
                        }}
                      >
                        {label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <Text style={[styles.emptyText, { color: theme.colors.text3 }]}>
            {t('chat.noResultsFound')}
          </Text>
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={item}
            onPress={() => onSelectEmoji(item)}
            style={({ pressed }) => [
              styles.tile,
              {
                width: cell,
                height: cell,
                backgroundColor: theme.colors.bgElev2,
                borderColor: pressed ? theme.colors.accent : theme.colors.lineSoft,
                borderRadius: theme.radius.sm,
              },
            ]}
          >
            <Text style={{ fontSize: cell * 0.52 }}>{item}</Text>
          </Pressable>
        )}
      />
    );
  };

  const tabButton = (value: PanelTab, label: string) => {
    const selected = tab === value;
    return (
      <Pressable
        key={value}
        accessibilityRole="tab"
        accessibilityState={{ selected }}
        onPress={() => setTab(value)}
        style={[
          styles.tabButton,
          { borderRadius: theme.radius.sm },
          selected && { backgroundColor: theme.colors.accent },
        ]}
      >
        <Text
          style={{
            fontSize: 13,
            fontWeight: '600',
            color: selected ? theme.colors.textOnAccent : theme.colors.text3,
          }}
        >
          {label}
        </Text>
      </Pressable>
    );
  };

  const body = (() => {
    if (tab === 'gifs' && onSelectGif) {
      return (
        <View style={{ flex: 1 }}>
          <GifPickerTab width={width} onSelect={onSelectGif} />
        </View>
      );
    }
    if (tab === 'stickers') {
      return (
        <>
          <ScrollView
            style={[
              styles.sidebar,
              { width: sidebarWidth, borderRightColor: theme.colors.lineSoft },
            ]}
            contentContainerStyle={styles.sidebarContent}
          >
            {stickerSources.map((source) =>
              sourceRow(
                source.key,
                source.kind === 'most' ? t('chat.mostUsed') : source.title,
                sourceIcon(source),
                source.key === activeStickerSource?.key,
                () => setStickerSource(source.key),
              ),
            )}
          </ScrollView>
          <View style={styles.grid}>
            {activeStickerSource
              ? expressionGrid(activeStickerSource, 'sticker')
              : message(query.trim() ? t('chat.noResultsFound') : emptyStickersText)}
          </View>
        </>
      );
    }
    return (
      <>
        <ScrollView
          style={[styles.sidebar, { width: sidebarWidth, borderRightColor: theme.colors.lineSoft }]}
          contentContainerStyle={styles.sidebarContent}
        >
          {emoteSources.map((source) =>
            sourceRow(
              source.key,
              // The column is narrow; the grid heading keeps the full "Most Used Emotes".
              source.kind === 'most' ? t('chat.mostUsed') : source.title,
              sourceIcon(source),
              source.key === activeEmojiSource,
              () => setEmojiSource(source.key),
            ),
          )}
          {emoteSources.length === 0 && !query.trim() ? (
            loading ? (
              <ActivityIndicator style={{ marginTop: 8 }} color={theme.colors.accent} />
            ) : (
              <Text style={[styles.sidebarNote, { color: theme.colors.text3 }]}>
                {emptyEmotesText}
              </Text>
            )
          ) : null}
          {/* Default emoji sit at the very bottom, under the realms. */}
          {sourceRow(
            DEFAULT_SOURCE,
            t('chat.defaultEmoji'),
            sourceIcon(null),
            activeEmojiSource === DEFAULT_SOURCE,
            () => setEmojiSource(DEFAULT_SOURCE),
          )}
        </ScrollView>
        <View style={styles.grid}>
          {activeEmoteSource ? expressionGrid(activeEmoteSource, 'emote') : emojiGrid()}
        </View>
      </>
    );
  })();

  const tabs = (
    <View style={styles.tabs}>
      {tabButton('emojis', t('chat.emojisTab'))}
      {tabButton('stickers', t('chat.stickersTab'))}
      {onSelectGif ? tabButton('gifs', t('chat.gifsTab')) : null}
    </View>
  );
  const closeButton = (
    <Pressable accessibilityRole="button" onPress={onClose} hitSlop={8}>
      <Text style={{ fontSize: 13, color: theme.colors.text3 }}>{t('common.close')}</Text>
    </Pressable>
  );
  // The GIF tab has its own search box, so hide the shared one there, as desktop does.
  const searchBox =
    tab === 'gifs' ? null : (
      <TextInput
        value={query}
        onChangeText={onQueryChange}
        placeholder={t('chat.searchShort')}
        placeholderTextColor={theme.colors.text3}
        accessibilityLabel={t('chat.searchExpressions')}
        autoCorrect={false}
        autoCapitalize="none"
        clearButtonMode="while-editing"
        returnKeyType="search"
        style={[
          compact ? styles.searchCompact : styles.search,
          {
            backgroundColor: theme.colors.bgElev2,
            color: theme.colors.text,
            borderColor: theme.colors.lineSoft,
            borderRadius: theme.radius.sm,
          },
        ]}
      />
    );

  const panel = (
    <Animated.View
      testID="expression-panel"
      style={[
        styles.panel,
        {
          width,
          backgroundColor: theme.colors.bgElev1,
          borderColor: theme.colors.lineSoft,
          borderRadius: theme.radius.lg,
          opacity: appear,
          transform: [
            { translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) },
          ],
        },
        placement ? { position: 'absolute', left: placement.left, bottom: placement.bottom } : null,
        theme.shadow.sheet,
      ]}
    >
      {compact ? (
        <View style={[styles.headerCompact, { borderBottomColor: theme.colors.lineSoft }]}>
          <View style={styles.headerRow}>
            {tabs}
            {closeButton}
          </View>
          {searchBox}
        </View>
      ) : (
        <View style={[styles.header, { borderBottomColor: theme.colors.lineSoft }]}>
          {tabs}
          <View style={styles.headerEnd}>
            {searchBox}
            {closeButton}
          </View>
        </View>
      )}
      <View style={[styles.body, { height: bodyHeight }]}>{body}</View>
    </Animated.View>
  );

  // Anchored above the composer, the panel shares the app window so the keyboard
  // and composer stay put. Without an anchor (reactions, opened from a modal) it
  // needs a modal of its own to show above that one.
  if (placement) {
    return (
      <OverlayPortal>
        <Pressable testID="expression-backdrop" style={StyleSheet.absoluteFill} onPress={onClose} />
        {panel}
      </OverlayPortal>
    );
  }
  return (
    <Modal
      visible
      transparent
      animationType="none"
      onRequestClose={onClose}
      supportedOrientations={[
        'portrait',
        'portrait-upside-down',
        'landscape',
        'landscape-left',
        'landscape-right',
      ]}
    >
      <View style={styles.centered}>
        <Pressable
          testID="expression-backdrop"
          style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.scrim }]}
          onPress={onClose}
        />
        {panel}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  panel: {
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tabs: {
    flexDirection: 'row',
    gap: 4,
  },
  tabButton: {
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  headerCompact: {
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  searchCompact: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderWidth: 1,
    fontSize: 14,
  },
  headerEnd: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  search: {
    width: 170,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderWidth: 1,
    fontSize: 13,
  },
  body: {
    flexDirection: 'row',
  },
  sidebar: {
    flexGrow: 0,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  sidebarContent: {
    padding: 6,
    gap: 2,
  },
  sidebarNote: {
    fontSize: 11,
    padding: 6,
  },
  sourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 6,
    paddingVertical: 6,
  },
  sourceRowCompact: {
    justifyContent: 'center',
    paddingHorizontal: 0,
    paddingVertical: 4,
  },
  sourceIconCompact: {
    width: 32,
    height: 32,
    borderRadius: 8,
  },
  sourceIcon: {
    width: 20,
    height: 20,
    borderRadius: 5,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  sourceGlyph: {
    fontSize: 11,
    fontWeight: '700',
  },
  sourceTitle: {
    flex: 1,
    fontSize: 12,
  },
  grid: {
    flex: 1,
    paddingHorizontal: GRID_PADDING,
    paddingTop: GRID_PADDING,
  },
  heading: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginBottom: 8,
  },
  chip: {
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  tile: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  stickerName: {
    fontSize: 10,
    marginTop: 2,
    paddingHorizontal: 4,
  },
  emptyText: {
    fontSize: 13,
    paddingVertical: 12,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
});
