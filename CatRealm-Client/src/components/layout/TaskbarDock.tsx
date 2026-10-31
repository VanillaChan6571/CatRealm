import type { ReactNode } from 'react';
import { usePinnedStore } from '../../stores/pinnedStore';
import { PinnedTaskbar } from './PinnedTaskbar';
import type { Tab } from '../home/HomeNav';

interface TaskbarDockProps {
  enabled: boolean;
  onNavigateHomeTab?: (tab: Tab) => void;
  children: ReactNode;
}

// Wraps the whole app shell and places the pinned taskbar on the configured window
// edge, reserving layout space (not overlaying). When disabled (mobile) it reproduces
// the original full-height `flex flex-col` shell (h-full, not h-screen: mobile 100vh overshoots the visible area and clips the composer) so children lay out unchanged.
export function TaskbarDock({ enabled, onNavigateHomeTab, children }: TaskbarDockProps) {
  const dockSide = usePinnedStore((s) => s.dockSide);

  if (!enabled) {
    return <div className="h-full flex flex-col">{children}</div>;
  }

  const isRow = dockSide === 'left' || dockSide === 'right';
  const barFirst = dockSide === 'top' || dockSide === 'left';
  const bar = <PinnedTaskbar onNavigateHomeTab={onNavigateHomeTab} />;

  return (
    <div className={`h-full flex ${isRow ? 'flex-row' : 'flex-col'}`}>
      {barFirst && bar}
      <div className="flex-1 min-w-0 min-h-0 flex flex-col">{children}</div>
      {!barFirst && bar}
    </div>
  );
}
