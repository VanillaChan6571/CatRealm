import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { FolderOpen } from 'lucide-react-native';
import { useTheme } from '@/theme';
import { Pressable } from './Pressable';
import { RAIL_WIDTH, RailLabel } from './RailExpansion';
import { ServerIcon } from './ServerIcon';
import { Text } from './Text';
import type { MobileServer, ServerFolder } from '@/stores/serverStore';

const TILE = 44;
const MINI = 18;

/**
 * A server folder in the drawer's icon rail, drawn like the desktop
 * ServerListBar: a tile tinted with the folder colour showing a 2×2 grid of
 * its servers while closed, and a folder icon heading a tinted pill that holds
 * the servers while open.
 */
export function RailFolder({
  folder,
  servers,
  activeServerId,
  unreadByServer,
  onToggle,
  renderServer,
}: {
  folder: ServerFolder;
  servers: MobileServer[];
  activeServerId: string | null;
  unreadByServer: Record<string, number>;
  onToggle: () => void;
  renderServer: (server: MobileServer) => ReactNode;
}) {
  const theme = useTheme();
  const color = folder.color || theme.colors.accent;
  const open = folder.isOpen;
  const containsActive = servers.some((server) => server.id === activeServerId);

  // While closed the folder stands in for its servers, so it carries their badges.
  let mentions = 0;
  let unread = false;
  for (const server of servers) {
    if (server.id === activeServerId) continue;
    mentions += server.mention || 0;
    if ((unreadByServer[server.url] ?? 0) > 0) unread = true;
  }

  const tile = (
    <Pressable
      haptic
      accessibilityRole="button"
      accessibilityLabel={folder.name}
      accessibilityState={{ expanded: open }}
      onPress={onToggle}
      style={[styles.item, open && styles.itemInPill]}
    >
      {containsActive && !open ? (
        <View style={[styles.activePill, { backgroundColor: color }]} />
      ) : null}
      <View
        style={[
          styles.tile,
          {
            backgroundColor: `${color}33`,
            boxShadow: [{ offsetX: 0, offsetY: 4, blurRadius: 14, color: `${color}55` }],
          },
        ]}
      >
        {open ? (
          <FolderOpen size={24} color={color} fill={`${color}55`} />
        ) : (
          <View style={styles.grid}>
            {Array.from({ length: 4 }, (_, index) => {
              const server = servers[index];
              return server ? (
                <ServerIcon key={server.id} server={server} size={MINI} square />
              ) : (
                <View key={`empty-${index}`} style={[styles.emptySlot, { backgroundColor: theme.colors.bgSidebar }]} />
              );
            })}
          </View>
        )}
        {/* Badges hang off the tile's corner, wherever the row's width ends up. */}
        {!open && mentions > 0 ? (
          <View style={[styles.badge, { backgroundColor: theme.colors.danger, borderColor: theme.colors.bgDeepest }]}>
            <Text style={styles.badgeText}>{mentions > 99 ? '99+' : mentions}</Text>
          </View>
        ) : !open && unread ? (
          <View style={[styles.unreadDot, { backgroundColor: theme.colors.text, borderColor: theme.colors.bgDeepest }]} />
        ) : null}
      </View>
      <RailLabel>
        <Text variant="body" numberOfLines={1} style={styles.label}>{folder.name}</Text>
      </RailLabel>
    </Pressable>
  );

  if (!open) return tile;

  return (
    <View
      style={[
        styles.openPill,
        {
          backgroundColor: `${color}28`,
          borderColor: `${color}55`,
          boxShadow: [{ offsetX: 0, offsetY: 4, blurRadius: 16, color: `${color}33` }],
        },
      ]}
    >
      {tile}
      {servers.map((server) => renderServer(server))}
    </View>
  );
}

// The tile sits where a collapsed rail centres it, so widening the rail reveals the name.
const RAIL_INSET = (RAIL_WIDTH - TILE) / 2;
const PILL_MARGIN = 6;

const styles = StyleSheet.create({
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 12,
    paddingLeft: RAIL_INSET,
    paddingRight: 12,
  },
  // Inside the open pill the tile keeps the same screen position.
  itemInPill: {
    paddingLeft: RAIL_INSET - PILL_MARGIN - 1.5,
  },
  label: {
    fontWeight: '600',
  },
  tile: {
    width: TILE,
    height: TILE,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grid: {
    width: MINI * 2 + 2,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 2,
  },
  emptySlot: {
    width: MINI,
    height: MINI,
    borderRadius: 4,
    opacity: 0.5,
  },
  activePill: {
    position: 'absolute',
    left: 0,
    width: 4,
    height: 28,
    borderTopRightRadius: 4,
    borderBottomRightRadius: 4,
  },
  openPill: {
    alignSelf: 'stretch',
    marginHorizontal: PILL_MARGIN,
    alignItems: 'stretch',
    gap: 10,
    paddingVertical: 8,
    borderRadius: 27,
    borderWidth: 1.5,
  },
  badge: {
    position: 'absolute',
    top: -6,
    right: -6,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 12,
  },
  unreadDot: {
    position: 'absolute',
    top: -4,
    right: -4,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
  },
});
