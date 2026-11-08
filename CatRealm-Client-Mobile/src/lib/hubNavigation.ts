import type { useRouter } from 'expo-router';

type Router = ReturnType<typeof useRouter>;

export type HubTabHref =
  | '/(app)/(tabs)/home'
  | '/(app)/(tabs)/discover'
  | '/(app)/(tabs)/chats'
  | '/(app)/(tabs)/servers'
  | '/(app)/(tabs)/me';

const HUB_TAB_PATHS = new Set(['/', '/home', '/discover', '/chats', '/servers', '/me']);

/**
 * Open a hub tab without stacking screens. On a tab already, switch tabs
 * (dismissTo alone does nothing there, since the tabs screen is the current
 * one). Anywhere else (a DM, notes, a realm), go back to the existing tabs
 * screen and then select the tab, instead of pushing a second tabs screen.
 */
export function goToHubTab(router: Router, pathname: string, href: HubTabHref): void {
  if (HUB_TAB_PATHS.has(pathname)) {
    router.navigate(href);
    return;
  }
  if (router.canDismiss()) {
    router.dismissTo(href);
    // dismissTo returns to the tabs screen as it was; select the requested tab.
    router.navigate(href);
    return;
  }
  router.replace(href);
}
