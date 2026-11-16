import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ openLink: vi.fn() }));
vi.mock('../../../lib/authApi', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createAuthenticatedApi: () => ({ put: vi.fn() }),
}));
vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('../../../utils/externalLinks', () => ({ isAllowedExternalUrl: () => true, openProtectedExternalUrl: mocks.openLink }));

import { ProfileBioEditor } from '../ProfileBioEditor';

const BIO = '*Secret Fashion Designer*\nMaking outfits for **Koikatsu**\nPixiv: https://www.pixiv.net/en/users/1';

beforeEach(() => { mocks.openLink.mockReset(); });
afterEach(cleanup);

it('renders bold, italics and links in someone else\'s bio instead of raw markdown', () => {
  render(<ProfileBioEditor bio={BIO} isOwnProfile={false} inCentralContext onUpdate={vi.fn()} />);
  expect(screen.getByText('Koikatsu').closest('strong')).not.toBeNull();
  expect(screen.getByText('Secret Fashion Designer').closest('em')).not.toBeNull();
  expect(screen.queryByText(/\*\*/)).toBeNull();
  const link = screen.getByRole('link', { name: 'https://www.pixiv.net/en/users/1' });
  fireEvent.click(link);
  expect(mocks.openLink).toHaveBeenCalledWith('https://www.pixiv.net/en/users/1', expect.any(Function));
});

it('a plain click on a link in your own bio edits it; Ctrl/Cmd-click opens the link', () => {
  render(<ProfileBioEditor bio={BIO} isOwnProfile inCentralContext onUpdate={vi.fn()} />);
  fireEvent.click(screen.getByRole('link'), { metaKey: true });
  expect(mocks.openLink).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('textbox')).toBeNull();

  fireEvent.click(screen.getByRole('link'));
  expect(mocks.openLink).toHaveBeenCalledTimes(1);
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(BIO);
});
