import type { ReactNode } from 'react';
import { BrowserRouter, HashRouter } from 'react-router-dom';

export function AppRouter({ children }: { children: ReactNode }) {
  // Packaged Electron loads one file. Keep client routes in its fragment so
  // navigation and reloads retain that exact document and its native bridge.
  const Router = window.location.protocol === 'file:' ? HashRouter : BrowserRouter;
  return <Router>{children}</Router>;
}
