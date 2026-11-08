/**
 * Tablet left column, laid out like the desktop client: the server rail and a
 * sidebar side by side, with the profile bar under both. It is mounted once by
 * the app layout and stays put across navigation; only the sidebar's contents
 * follow the route (home sidebar, or the open realm's channel list).
 */

import { StyleSheet, View } from 'react-native';
import { useGlobalSearchParams, usePathname } from 'expo-router';
import { useTheme } from '@/theme';
import { DrawerLeftRail } from '@/components/BottomDock';
import { useUIStore } from '@/stores/uiStore';
import { TabletChannelSidebar } from './TabletChannelSidebar';
import { TabletHomeSidebar } from './TabletHomeSidebar';
import { TabletProfileBar } from './TabletProfileBar';

export const TABLET_LEFT_COLUMN_WIDTH = 346;

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function TabletShell() {
  const theme = useTheme();
  const pathname = usePathname();
  const params = useGlobalSearchParams<{ serverId?: string; channelId?: string }>();
  const setServerDrawerOpen = useUIStore((s) => s.setServerDrawerOpen);
  const serverId = pathname.startsWith('/server/') ? firstParam(params.serverId) : undefined;
  const channelId = firstParam(params.channelId);

  return (
    <View
      style={[
        styles.column,
        { backgroundColor: theme.colors.bgSidebar, borderRightColor: theme.colors.lineSoft },
      ]}
    >
      <View style={styles.top}>
        <DrawerLeftRail
          onClose={() => setServerDrawerOpen(false)}
          // Inside a realm, tapping it again does nothing (as on desktop) rather than reloading it.
          onActiveServerPress={serverId ? () => undefined : undefined}
          navigateOnSelect
          showHome
        />
        {serverId ? (
          <TabletChannelSidebar serverId={serverId} channelId={channelId} />
        ) : (
          <TabletHomeSidebar />
        )}
      </View>
      <TabletProfileBar />
    </View>
  );
}

const styles = StyleSheet.create({
  column: {
    width: TABLET_LEFT_COLUMN_WIDTH,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  top: {
    flex: 1,
    flexDirection: 'row',
    minHeight: 0,
  },
});
