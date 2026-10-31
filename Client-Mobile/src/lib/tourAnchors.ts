import type { View } from 'react-native';

// Anchors: screens register the views a step can point at. A scroller lets a
// step bring an off-screen anchor into view (the You tab's settings list).
type Anchor = { view: View; scrollIntoView?: (windowY: number) => void };
const anchors = new Map<string, Anchor>();

export function registerTourAnchor(name: string, anchor: Anchor) {
  anchors.set(name, anchor);
  return () => {
    if (anchors.get(name)?.view === anchor.view) anchors.delete(name);
  };
}

export function getTourAnchor(name: string): Anchor | undefined {
  return anchors.get(name);
}
