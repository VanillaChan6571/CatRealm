/**
 * Renders the synced server list grouped into folders (Discord-style), shared by
 * the ServerDrawer and the Servers tab. Visible menus and a folder picker
 * support creating, moving, renaming, recoloring, and deleting folders. All mutations flow through serverStore and sync back to
 * Central.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useFocusEffect } from 'expo-router';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { ArrowUpDown, ChevronDown, ChevronRight, Folder, FolderOpen, FolderPlus, MoreHorizontal, X, Trash2, Check } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme';
import { Text } from './Text';
import { Pressable } from './Pressable';
import { IconBtn } from './IconBtn';
import { Sheet } from './Sheet';
import { ServerIcon } from './ServerIcon';
import { ArrangeItem, type ArrangeIndicator } from './ArrangeItem';
import { applyDrop, childItemId, computeDropTarget, topItemId, type DragSource, type DropTarget, type Rect } from '@/lib/arrangeDrop';
import { useServerStore } from '@/stores/serverStore';
import type { MobileServer, ServerFolder } from '@/stores/serverStore';
import { buildServerListItems, folderContainingServer } from '@/lib/serverListItems';
import { useDeviceLayout } from '@/hooks/useDeviceLayout';
import { syncRealmUnreadCounts, useRealmUnreadStore } from '@/lib/realmReadState';

const FOLDER_COLORS = [
  '#5865F2', '#7C5CFF', '#23A559', '#F0B232', '#F23F42',
  '#EB459E', '#00A8FC', '#E67E22', '#95A5A6', '#1ABC9C',
];

function isValidHex(v: string): boolean {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v.trim());
}

/** Expands #RGB → #RRGGBB and lowercases; assumes isValidHex(v) is true. */
function normalizeHex(v: string): string {
  const t = v.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(t)) {
    return `#${t[1]}${t[1]}${t[2]}${t[2]}${t[3]}${t[3]}`;
  }
  return t;
}

interface ServerListSectionProps {
  variant: 'drawer' | 'panel';
  activeServerId: string | null;
  onServerPress: (server: MobileServer) => void;
  renderTrailing?: (server: MobileServer) => ReactNode;
  renderSubtitle?: (server: MobileServer) => ReactNode;
  disabled?: boolean;
  /** When set, rows whose id !== this value are dimmed (e.g. while opening one). */
  dimServerId?: string | null;
}

export function ServerListSection({
  variant,
  activeServerId,
  onServerPress,
  renderTrailing,
  renderSubtitle,
  disabled,
  dimServerId,
}: ServerListSectionProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const { isTablet } = useDeviceLayout();
  const servers = useServerStore((s) => s.servers);
  const unreadByServer = useRealmUnreadStore((s) => s.byServer);
  // Throttled per realm, so opening the list repeatedly costs nothing extra.
  useEffect(() => {
    void syncRealmUnreadCounts(servers.filter((server) => server.token).map((server) => ({ serverUrl: server.url, token: server.token })));
  }, [servers]);
  const serverLayout = useServerStore((s) => s.serverLayout);
  const serverFolders = useServerStore((s) => s.serverFolders);
  const toggleFolder = useServerStore((s) => s.toggleFolder);
  const createFolder = useServerStore((s) => s.createFolder);
  const addServerToFolder = useServerStore((s) => s.addServerToFolder);
  const removeServerFromFolder = useServerStore((s) => s.removeServerFromFolder);
  const updateFolder = useServerStore((s) => s.updateFolder);
  const deleteFolder = useServerStore((s) => s.deleteFolder);
  const applyLayoutAndFolders = useServerStore((s) => s.applyLayoutAndFolders);

  const [editor, setEditorState] = useState<
    | { type: 'server'; server: MobileServer }
    | { type: 'folder'; folder: ServerFolder }
    | { type: 'create'; selected: string[] }
    | { type: 'add'; folder: ServerFolder }
    | null
  >(null);
  // Arrange mode: realms and folders wobble and can be dragged into place, into
  // a folder, or out of one.
  const [arranging, setArranging] = useState(false);
  const [drag, setDrag] = useState<{ source: DragSource; target: DropTarget } | null>(null);
  const itemViews = useRef(new Map<string, View>());
  const itemRects = useRef(new Map<string, Rect>());
  // Gesture callbacks arrive between renders; read the latest drag from here. It is
  // written as each callback runs, not on render: a quick drag can start and end
  // before React renders the start.
  const dragRef = useRef(drag);
  const updateDrag = (next: typeof drag) => {
    dragRef.current = next;
    setDrag(next);
  };
  useFocusEffect(useCallback(() => () => { setEditorState(null); setArranging(false); dragRef.current = null; setDrag(null); }, []));
  const setEditor = (next: typeof editor) => setEditorState(next);
  const closeEditor = () => setEditor(null);
  const items = useMemo(() => buildServerListItems(servers, serverLayout, serverFolders), [servers, serverLayout, serverFolders]);
  const itemGap = variant === 'panel' ? 10 : 6;

  const startArranging = () => {
    closeEditor();
    setArranging(true);
  };

  const registerItem = useCallback((id: string, view: View | null) => {
    if (view) itemViews.current.set(id, view);
    else itemViews.current.delete(id);
  }, []);

  /** Item ids are `s:`/`f:` for top-level realms/folders and `c:folder:realm` inside folders. */
  const sourceFor = (id: string): DragSource | null => {
    if (id.startsWith('c:')) {
      const [, folderId, ...rest] = id.split(':');
      return { kind: 'child', folderId, serverId: rest.join(':') };
    }
    const index = items.findIndex((item) => topItemId(item) === id);
    return index === -1 ? null : { kind: 'top', index };
  };

  // Window positions of everything droppable, taken once as a drag begins.
  const measureItems = () => {
    itemRects.current = new Map();
    itemViews.current.forEach((view, id) => {
      view.measureInWindow((_x, y, _width, height) => {
        if (height > 0) itemRects.current.set(id, { y, height });
      });
    });
  };

  const handleDragStart = (id: string) => {
    const source = sourceFor(id);
    if (!source) return;
    measureItems();
    // Until the finger moves, the item would land back where it is.
    let target: DropTarget;
    if (source.kind === 'top') {
      target = { type: 'top', index: source.index };
    } else {
      const folderItem = items.find((item) => item.type === 'folder' && item.folder.id === source.folderId);
      const index = folderItem?.type === 'folder'
        ? folderItem.servers.findIndex((server) => server.id === source.serverId)
        : 0;
      target = { type: 'folder', folderId: source.folderId, index: Math.max(0, index) };
    }
    updateDrag({ source, target });
  };

  const handleDragMove = (_id: string, absoluteY: number) => {
    const current = dragRef.current;
    if (!current || itemRects.current.size === 0) return;
    const target = computeDropTarget(absoluteY, current.source, items, itemRects.current);
    const same = target.type === current.target.type && target.index === current.target.index
      && (target.type !== 'folder' || (current.target.type === 'folder' && target.folderId === current.target.folderId));
    if (!same) updateDrag({ source: current.source, target });
  };

  const handleDragEnd = () => {
    const current = dragRef.current;
    updateDrag(null);
    if (!current) return;
    const result = applyDrop(items, serverFolders, current.source, current.target);
    if (result) applyLayoutAndFolders(result.layout, result.folders);
  };

  // Top-level reorders of a top-level item slide the items in between aside.
  const shiftFor = (index: number) => {
    if (!drag || drag.source.kind !== 'top' || drag.target.type !== 'top' || index === drag.source.index) return 0;
    const from = drag.source.index;
    const to = drag.target.index;
    const span = (itemRects.current.get(topItemId(items[from]))?.height ?? 0) + itemGap;
    if (from < index && index <= to) return -span;
    if (to <= index && index < from) return span;
    return 0;
  };

  // A realm leaving its folder lands on a top-level line; moves into a folder
  // light the folder up and mark the spot among its realms.
  const topIndicator = (index: number): ArrangeIndicator => {
    if (!drag || drag.source.kind !== 'child' || drag.target.type !== 'top') return null;
    if (drag.target.index === index) return 'before';
    return drag.target.index >= items.length && index === items.length - 1 ? 'after' : null;
  };
  const childIndicator = (folderId: string, folderServers: MobileServer[], serverId: string): ArrangeIndicator => {
    if (!drag || drag.target.type !== 'folder' || drag.target.folderId !== folderId) return null;
    const sourceItem = drag.source.kind === 'top' ? items[drag.source.index] : undefined;
    const draggedId = drag.source.kind === 'child' ? drag.source.serverId
      : sourceItem?.type === 'server' ? sourceItem.server.id : null;
    const others = folderServers.filter((server) => server.id !== draggedId);
    const position = others.findIndex((server) => server.id === serverId);
    if (position === -1) return null;
    if (position === drag.target.index) return 'before';
    return drag.target.index >= others.length && position === others.length - 1 ? 'after' : null;
  };
  const dropHighlightsFolder = (folderId: string) =>
    !!drag && drag.target.type === 'folder' && drag.target.folderId === folderId
    && !(drag.source.kind === 'child' && drag.source.folderId === folderId);

  const renderServerRow = (server: MobileServer, indented: boolean) => {
    const active = server.id === activeServerId;
    const subtitle = renderSubtitle ? renderSubtitle(server) : (
      <Text variant="caption" color={theme.colors.text3} numberOfLines={1}>
        {t('servers.membersOnline', { count: server.membersOnline })}
      </Text>
    );
    return (
      <View key={server.id} style={[styles.serverRow, {
        borderRadius: 18,
        opacity: dimServerId && dimServerId !== server.id ? 0.55 : 1,
        backgroundColor: active ? theme.colors.bgElev2 : theme.colors.bgElev1,
        borderColor: active ? theme.colors.accentRim : theme.colors.lineSoft,
      }]}>
        <Pressable
          haptic disabled={disabled || arranging} accessibilityRole="button" accessibilityLabel={server.name}
          accessibilityState={{ selected: active, disabled: !!disabled }}
          onPress={() => { closeEditor(); onServerPress(server); }}
          onLongPress={() => setEditor({ type: 'server', server })}
          style={styles.serverMain}
        >
          <ServerIcon server={server} size={indented || variant === 'drawer' ? 40 : 48} active={active} badge={server.mention} unread={!active && (unreadByServer[server.url] ?? 0) > 0} />
          <View style={styles.serverText}>
            <Text variant="body" numberOfLines={1}>{server.name}</Text>
            {subtitle}
          </View>
        </Pressable>
        {renderTrailing ? renderTrailing(server) : null}
        <IconBtn icon={MoreHorizontal} disabled={disabled || arranging}
          accessibilityLabel={t('folders.serverOptions', { name: server.name })}
          onPress={() => setEditor({ type: 'server', server })} />
      </View>
    );
  };

  const renderFolder = (folder: ServerFolder, folderServers: MobileServer[]) => {
    const mentionTotal = folderServers.reduce((sum, server) => sum + (server.mention || 0), 0);
    const FolderGlyph = folder.isOpen ? FolderOpen : Folder;
    const Chevron = folder.isOpen ? ChevronDown : ChevronRight;
    return (
      <View key={folder.id} style={[styles.folderWrap, { backgroundColor: theme.colors.bgElev1, borderColor: theme.colors.lineSoft }]}>
        <View style={styles.folderHeader}>
          <Pressable haptic disabled={disabled || arranging} accessibilityRole="button"
            accessibilityLabel={folder.name} accessibilityState={{ expanded: folder.isOpen }}
            onPress={() => toggleFolder(folder.id)}
            onLongPress={() => setEditor({ type: 'folder', folder })}
            style={styles.serverMain}>
            <View style={[styles.folderGlyph, { backgroundColor: theme.colors.bgElev2, borderRadius: 14 }]}>
              <FolderGlyph size={22} color={folder.color} />
            </View>
            <View style={styles.serverText}>
              <Text variant="body" numberOfLines={1}>{folder.name}</Text>
              <Text variant="caption" color={theme.colors.text3}>
                {t('folders.serverCount', { count: folderServers.length })}
              </Text>
            </View>
            {!folder.isOpen && mentionTotal > 0 ? (
              <View style={[styles.folderBadge, { backgroundColor: theme.colors.danger }]}>
                <Text variant="caption" color="#FFFFFF">{mentionTotal > 99 ? '99+' : mentionTotal}</Text>
              </View>
            ) : !folder.isOpen && folderServers.some((server) => server.id !== activeServerId && (unreadByServer[server.url] ?? 0) > 0) ? (
              <View style={[styles.folderUnreadDot, { backgroundColor: theme.colors.text }]} />
            ) : null}
            <Chevron size={16} color={theme.colors.text3} />
          </Pressable>
          <IconBtn icon={MoreHorizontal} disabled={disabled || arranging}
            accessibilityLabel={t('folders.folderOptions', { name: folder.name })}
            onPress={() => setEditor({ type: 'folder', folder })} />
        </View>
        {folder.isOpen ? (
          <View style={[styles.folderChildren, { borderLeftColor: folder.color }]}>
            {folderServers.map((server) => (
              <ArrangeItem
                key={server.id}
                id={childItemId(folder.id, server.id)}
                arranging={arranging}
                dragging={drag?.source.kind === 'child' && drag.source.serverId === server.id}
                indicator={childIndicator(folder.id, folderServers, server.id)}
                indicatorColor={theme.colors.accent}
                onRegister={registerItem}
                onDragStart={handleDragStart}
                onDragMove={handleDragMove}
                onDragEnd={handleDragEnd}
              >
                {renderServerRow(server, true)}
              </ArrangeItem>
            ))}
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <View style={{ gap: itemGap }}>
      <View style={styles.toolbar}>
        {arranging ? (
          <Text variant="caption" color={theme.colors.text3} style={styles.arrangeHint}>
            {t('folders.arrangeHint')}
          </Text>
        ) : (
          <Pressable haptic disabled={disabled || !servers.length}
            onPress={() => setEditor({ type: 'create', selected: [] })}
            style={[styles.toolbarButton, { backgroundColor: theme.colors.bgElev2 }]}>
            <FolderPlus size={18} color={theme.colors.accentText} />
            <Text variant="caption" color={theme.colors.accentText}>{t('folders.newFolder')}</Text>
          </Pressable>
        )}
        {arranging ? (
          <Pressable haptic accessibilityRole="button" onPress={() => { setArranging(false); updateDrag(null); }}
            style={[styles.toolbarButton, { backgroundColor: theme.colors.accent }]}>
            <Check size={18} color={theme.colors.textOnAccent} />
            <Text variant="caption" color={theme.colors.textOnAccent}>{t('folders.arrangeDone')}</Text>
          </Pressable>
        ) : (
          <IconBtn icon={ArrowUpDown} disabled={disabled || items.length < 2}
            accessibilityLabel={t('folders.reorder')}
            onPress={startArranging} />
        )}
      </View>
      {items.map((item, index) => (
        <ArrangeItem
          key={topItemId(item)}
          id={topItemId(item)}
          arranging={arranging}
          dragging={drag?.source.kind === 'top' && drag.source.index === index}
          raised={item.type === 'folder' && drag?.source.kind === 'child' && drag.source.folderId === item.folder.id}
          shift={shiftFor(index)}
          indicator={topIndicator(index)}
          indicatorColor={theme.colors.accent}
          highlight={item.type === 'folder' && dropHighlightsFolder(item.folder.id)}
          highlightColor={item.type === 'folder' ? item.folder.color : undefined}
          onRegister={registerItem}
          onDragStart={handleDragStart}
          onDragMove={handleDragMove}
          onDragEnd={handleDragEnd}
        >
          {item.type === 'server' ? renderServerRow(item.server, false) : renderFolder(item.folder, item.servers)}
        </ArrangeItem>
      ))}

      {/* Tablets show the editor as a centred dialog, as desktop does; phones use a bottom sheet. */}
      <Sheet open={!!editor} onClose={closeEditor} maxHeightFraction={0.8} avoidKeyboard
        presentation={isTablet ? 'center' : 'bottom'}>
        <View style={styles.sheetHeader}>
          <IconBtn icon={X} accessibilityLabel={t('common.close')} onPress={closeEditor} />
        </View>
        {editor?.type === 'server' ? (
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 24 }}>
            <ManageServerSheet server={editor.server} folders={serverFolders}
              onAddToFolder={(id) => { addServerToFolder(editor.server.id, id); closeEditor(); }}
              onRemoveFromFolder={(id) => { removeServerFromFolder(editor.server.id, id); closeEditor(); }}
              onCreateFolder={() => setEditor({ type: 'create', selected: [editor.server.id] })}
              onReorder={startArranging} />
          </ScrollView>
        ) : null}
        {editor?.type === 'folder' ? (
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 24 }}>
            <FolderSettingsSheet key={editor.folder.id} folder={editor.folder}
              onAddServers={() => setEditor({ type: 'add', folder: editor.folder })}
              onApply={(name, color) => { updateFolder(editor.folder.id, { name, color }); closeEditor(); }}
              onDelete={() => { deleteFolder(editor.folder.id); closeEditor(); }} />
          </ScrollView>
        ) : null}
        {editor?.type === 'create' || editor?.type === 'add' ? (
          <FolderServerPicker key={editor.type === 'add' ? editor.folder.id : 'create'}
            servers={editor.type === 'add' ? servers.filter((server) => !serverFolders.find((f) => f.id === editor.folder.id)?.serverUrls.includes(server.id)) : servers}
            folders={serverFolders}
            initialSelected={editor.type === 'create' ? editor.selected : []}
            folderName={editor.type === 'add' ? editor.folder.name : undefined}
            onSave={(ids, name) => {
              if (editor.type === 'create') createFolder(ids, name);
              else ids.forEach((id) => addServerToFolder(id, editor.folder.id));
              closeEditor();
            }} />
        ) : null}
      </Sheet>
    </View>
  );
}

function FolderServerPicker({ servers, folders, initialSelected, folderName, onSave }: {
  servers: MobileServer[];
  folders: ServerFolder[];
  initialSelected: string[];
  folderName?: string;
  onSave: (ids: string[], name: string) => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [selected, setSelected] = useState(initialSelected);
  const selectedIds = selected.filter((id) => servers.some((server) => server.id === id));
  const canSave = selectedIds.length > 0 && (folderName !== undefined || name.trim().length > 0);
  return (
    <View style={[styles.sheetBody, { flex: 1 }]}>
      <Text variant="subtitle">{folderName === undefined ? t('folders.newFolder') : t('folders.addToFolder', { name: folderName })}</Text>
      <Text variant="caption" color={theme.colors.text3}>{t('folders.selectServersHint')}</Text>
      {folderName === undefined ? (
        <TextInput value={name} onChangeText={setName} maxLength={60}
          accessibilityLabel={t('folders.folderName')} placeholder={t('folders.folderNamePlaceholder')}
          placeholderTextColor={theme.colors.text3}
          style={[styles.input, { color: theme.colors.text, backgroundColor: theme.colors.bgElev2, borderColor: theme.colors.lineSoft }]} />
      ) : null}
      <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 8, paddingBottom: 12 }}>
        {!servers.length ? <Text color={theme.colors.text3}>{t('folders.allServersIncluded')}</Text> : null}
        {servers.map((server) => {
          const checked = selected.includes(server.id);
          const currentFolder = folderContainingServer(server.id, folders);
          return (
            <Pressable key={server.id} accessibilityRole="checkbox" accessibilityLabel={server.name}
              accessibilityState={{ checked }}
              onPress={() => setSelected((ids) => checked ? ids.filter((id) => id !== server.id) : [...ids, server.id])}
              style={[styles.pickerRow, { backgroundColor: theme.colors.bgElev2, borderColor: checked ? theme.colors.accentRim : theme.colors.lineSoft }]}>
              <ServerIcon server={server} size={36} />
              <View style={styles.serverText}>
                <Text variant="body" numberOfLines={1}>{server.name}</Text>
                {currentFolder ? <Text variant="caption" color={theme.colors.text3} numberOfLines={1}>{currentFolder.name}</Text> : null}
              </View>
              <View style={[styles.checkbox, { borderColor: checked ? theme.colors.accent : theme.colors.text3, backgroundColor: checked ? theme.colors.accent : 'transparent' }]}>
                {checked ? <Check size={14} color={theme.colors.textOnAccent} /> : null}
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
      <Pressable disabled={!canSave} accessibilityRole="button"
        onPress={() => onSave(selectedIds, name.trim())}
        style={[styles.applyBtn, { backgroundColor: theme.colors.accent, opacity: canSave ? 1 : 0.4 }]}>
        <Text variant="body" color={theme.colors.textOnAccent}>{t('folders.saveSelection', { count: selectedIds.length })}</Text>
      </Pressable>
    </View>
  );
}

function ManageServerSheet({
  server,
  folders,
  onAddToFolder,
  onRemoveFromFolder,
  onCreateFolder,
  onReorder,
}: {
  server: MobileServer;
  folders: ServerFolder[];
  onAddToFolder: (folderId: string) => void;
  onRemoveFromFolder: (folderId: string) => void;
  onCreateFolder: () => void;
  onReorder: () => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const currentFolder = folderContainingServer(server.id, folders);
  const otherFolders = folders.filter((f) => f.id !== currentFolder?.id);

  return (
    <View style={styles.sheetBody}>
      <Text variant="subtitle" numberOfLines={1}>{server.name}</Text>
      <Text variant="caption" color={theme.colors.text3} style={{ marginBottom: 4 }}>
        {t('folders.manageServer')}
      </Text>

      <View style={[styles.actionList, { borderColor: theme.colors.lineSoft, backgroundColor: theme.colors.bgElev2 }]}>
        <Pressable style={styles.actionBtn} onPress={onCreateFolder}>
          <Folder size={18} color={theme.colors.accentText} />
          <Text variant="body">{t('folders.createFolder')}</Text>
        </Pressable>
        {otherFolders.map((folder) => (
          <Pressable
            key={folder.id}
            style={[styles.actionBtn, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.lineSoft }]}
            onPress={() => onAddToFolder(folder.id)}
          >
            <View style={[styles.swatchDot, { backgroundColor: folder.color }]} />
            <Text variant="body" numberOfLines={1}>{t(currentFolder ? 'folders.moveToFolder' : 'folders.addToFolder', { name: folder.name })}</Text>
          </Pressable>
        ))}
        <Pressable
          style={[styles.actionBtn, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.lineSoft }]}
          onPress={onReorder}
        >
          <ArrowUpDown size={18} color={theme.colors.text2} />
          <Text variant="body">{t('folders.reorder')}</Text>
        </Pressable>
      </View>

      {currentFolder ? (
        <Pressable
          onPress={() => onRemoveFromFolder(currentFolder.id)}
          style={[styles.dangerBtn, { borderColor: theme.colors.danger, backgroundColor: theme.colors.bgElev2 }]}
        >
          <Text variant="body" color={theme.colors.danger}>{t('folders.removeFromFolder')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function FolderSettingsSheet({
  folder,
  onApply,
  onDelete,
  onAddServers,
}: {
  folder: ServerFolder;
  onApply: (name: string, color: string) => void;
  onDelete: () => void;
  onAddServers: () => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const [name, setName] = useState(folder.name);
  const [color, setColor] = useState(folder.color);
  const [hexInput, setHexInput] = useState(folder.color);

  const selectPreset = (c: string) => {
    setColor(c);
    setHexInput(c);
  };

  const handleHexInput = (v: string) => {
    setHexInput(v);
    if (isValidHex(v)) setColor(normalizeHex(v));
  };

  return (
    <View style={styles.sheetBody}>
      <Text variant="subtitle">{t('folders.folderSettings')}</Text>
      <Pressable onPress={onAddServers} style={[styles.toolbarButton, { backgroundColor: theme.colors.bgElev2 }]}>
        <FolderPlus size={18} color={theme.colors.accentText} />
        <Text variant="body" color={theme.colors.accentText}>{t('folders.addServers')}</Text>
      </Pressable>

      <Text variant="caption" color={theme.colors.text3}>{t('folders.folderName')}</Text>
      <TextInput
        value={name}
        maxLength={60}
        accessibilityLabel={t('folders.folderName')}
        onChangeText={setName}
        placeholder={t('folders.folderNamePlaceholder')}
        placeholderTextColor={theme.colors.text3}
        style={[styles.input, { color: theme.colors.text, backgroundColor: theme.colors.bgElev2, borderColor: theme.colors.lineSoft }]}
      />

      <Text variant="caption" color={theme.colors.text3}>{t('folders.folderColor')}</Text>
      <View style={styles.swatchRow}>
        {FOLDER_COLORS.map((c) => {
          const selected = normalizeHex(c) === normalizeHex(color);
          return (
            <Pressable
              key={c}
              accessibilityRole="button"
              accessibilityLabel={t('folders.colorOption', { color: c })}
              accessibilityState={{ selected }}
              onPress={() => selectPreset(c)}
              style={[styles.swatch, { backgroundColor: c, borderColor: selected ? theme.colors.text : 'transparent' }]}
            >
              {selected ? <Check size={16} color="#FFFFFF" /> : null}
            </Pressable>
          );
        })}
      </View>

      <View style={styles.hexRow}>
        <View style={[styles.hexPreview, { backgroundColor: isValidHex(hexInput) ? normalizeHex(hexInput) : color, borderColor: theme.colors.lineSoft }]} />
        <TextInput
          value={hexInput}
          onChangeText={handleHexInput}
          placeholder="#5865F2"
          placeholderTextColor={theme.colors.text3}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={7}
          style={[styles.input, styles.hexInput, { color: theme.colors.text, backgroundColor: theme.colors.bgElev2, borderColor: theme.colors.lineSoft }]}
        />
      </View>

      <View style={styles.settingsActions}>
        <Pressable
          onPress={onDelete}
          style={[styles.iconDangerBtn, { borderColor: theme.colors.danger, backgroundColor: theme.colors.bgElev2 }]}
        >
          <Trash2 size={16} color={theme.colors.danger} />
          <Text variant="body" color={theme.colors.danger}>{t('common.delete')}</Text>
        </Pressable>
        <Pressable
          onPress={() => onApply(name.trim() || folder.name, color)}
          style={[styles.applyBtn, { backgroundColor: theme.colors.accent }]}
        >
          <Text variant="body" color={theme.colors.textOnAccent}>{t('common.save')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 },
  toolbarButton: { flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14 },
  arrangeHint: { flex: 1, paddingLeft: 4 },
  serverMain: { flex: 1, flexDirection: 'row', gap: 10, paddingHorizontal: 10, paddingVertical: 12, justifyContent: 'flex-start' },
  sheetHeader: { alignItems: 'flex-end', paddingHorizontal: 12 },
  pickerRow: { flexDirection: 'row', gap: 12, padding: 12, borderRadius: 14, borderWidth: 1 },
  checkbox: { width: 22, height: 22, borderRadius: 7, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  serverRow: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    paddingRight: 2,
  },
  serverText: {
    flex: 1,
    minWidth: 0,
  },
  folderWrap: {
    gap: 4,
    borderWidth: 1,
    borderRadius: 20,
    padding: 4,
  },
  folderHeader: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 2,
  },
  folderGlyph: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  folderUnreadDot: { width: 8, height: 8, borderRadius: 4, marginRight: 4 },
  folderBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  folderChildren: {
    borderLeftWidth: 2,
    marginLeft: 16,
    marginRight: 4,
    marginBottom: 8,
    paddingLeft: 8,
    gap: 6,
  },
  sheetBody: {
    paddingHorizontal: 16,
    paddingTop: 6,
    gap: 10,
  },
  actionList: {
    borderRadius: 8,
    borderWidth: 1,
    overflow: 'hidden',
  },
  actionBtn: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
  },
  swatchDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
  },
  dangerBtn: {
    marginTop: 4,
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  swatchRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  swatch: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hexRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  hexPreview: {
    width: 34,
    height: 34,
    borderRadius: 8,
    borderWidth: 1,
  },
  hexInput: {
    flex: 1,
    fontFamily: 'monospace',
  },
  reorderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    paddingLeft: 10,
    paddingRight: 4,
    paddingVertical: 6,
  },
  reorderGlyph: {
    width: 36,
    height: 36,
  },
  settingsActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6,
  },
  iconDangerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 14,
    minHeight: 44,
  },
  applyBtn: {
    borderRadius: 8,
    paddingHorizontal: 22,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
