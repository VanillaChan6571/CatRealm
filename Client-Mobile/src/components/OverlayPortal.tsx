import { createContext, useContext, useId, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

type OverlayRegistry = {
  put: (id: string, content: ReactNode) => void;
  remove: (id: string) => void;
};
const OverlayContext = createContext<OverlayRegistry | null>(null);

/** Same native window as the app: uncovered areas remain interactive. */
export function OverlayProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<Record<string, ReactNode>>({});
  const registry = useMemo<OverlayRegistry>(() => ({
    put: (id, content) => setEntries((current) => ({ ...current, [id]: content })),
    remove: (id) => setEntries((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    }),
  }), []);
  return (
    <OverlayContext.Provider value={registry}>
      <View style={styles.root}>
        {children}
        <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
          {Object.entries(entries).map(([id, content]) => (
            <View key={id} pointerEvents="box-none" style={StyleSheet.absoluteFill}>{content}</View>
          ))}
        </View>
      </View>
    </OverlayContext.Provider>
  );
}

export function OverlayPortal({ children }: { children: ReactNode }) {
  const registry = useContext(OverlayContext);
  const id = useId();
  useLayoutEffect(() => { registry?.put(id, children); }, [registry, id, children]);
  useLayoutEffect(() => () => { registry?.remove(id); }, [registry, id]);
  if (!registry) throw new Error('OverlayPortal requires OverlayProvider');
  return null;
}

const styles = StyleSheet.create({ root: { flex: 1 } });
