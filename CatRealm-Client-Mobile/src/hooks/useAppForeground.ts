import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

export function useAppForeground() {
  const [foreground, setForeground] = useState(AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
  useEffect(() => {
    const listener = AppState.addEventListener('change', (state) => setForeground(state === 'active'));
    return () => listener.remove();
  }, []);
  return foreground;
}
