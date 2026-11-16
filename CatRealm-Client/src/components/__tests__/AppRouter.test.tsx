import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { Link, useLocation } from 'react-router-dom';
import { AppRouter } from '../AppRouter';

const { createAppSecurity } = createRequire(import.meta.url)('../../../electron/appSecurity.cjs');
const indexPath = resolve('/synthetic/CatRealm/dist/index.html');
const indexUrl = pathToFileURL(indexPath).href;
const policy = createAppSecurity({ indexPath, isDev: false });
const dom = (globalThis as unknown as { jsdom: { reconfigure(options: { url: string }): void } }).jsdom;

// Reconfigure after environment setup, which needs a nonopaque storage origin.
beforeEach(() => dom.reconfigure({ url: indexUrl }));
afterEach(() => {
  cleanup();
  dom.reconfigure({ url: 'http://localhost:3000/' });
});

function Navigation() {
  const location = useLocation();
  return <>
    <output>{location.pathname}{location.search}</output>
    <Link to="/invite/synthetic">Invite</Link>
    <Link to="/app?invite=synthetic">Home</Link>
  </>;
}

it('keeps the trusted packaged document and native IPC across invite and home navigation', () => {
  const contents = {
    mainFrame: { get url() { return window.location.href; } },
    isDestroyed: () => false,
  };
  policy.register(contents);
  render(<AppRouter><Navigation /></AppRouter>);

  fireEvent.click(screen.getByText('Invite'));
  expect(screen.getByRole('status').textContent).toBe('/invite/synthetic');
  expect(window.location.pathname).toBe(new URL(indexUrl).pathname);
  expect(policy.isTrustedSender({ sender: contents, senderFrame: contents.mainFrame })).toBe(true);

  fireEvent.click(screen.getByText('Home'));
  expect(screen.getByRole('status').textContent).toBe('/app?invite=synthetic');
  expect(window.location.pathname).toBe(new URL(indexUrl).pathname);
  expect(policy.isTrustedSender({ sender: contents, senderFrame: contents.mainFrame })).toBe(true);
});

it('preserves the standalone wizard query inside the packaged route', () => {
  dom.reconfigure({ url: `${indexUrl}#/?standalone=screenshare-wizard` });
  render(<AppRouter><Navigation /></AppRouter>);
  expect(screen.getByRole('status').textContent).toBe('/?standalone=screenshare-wizard');
  expect(policy.isAppUrl(window.location.href)).toBe(true);
});
