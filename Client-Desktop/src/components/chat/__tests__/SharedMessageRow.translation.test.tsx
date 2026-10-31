import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import '../../../i18n';
import type { MessageTranslation } from '../../../lib/translation';

const translation = vi.hoisted(() => ({
  current: null as MessageTranslation | null,
  request: vi.fn(),
}));
vi.mock('../../../lib/translation/useAutoTranslation', () => ({
  useAutoTranslation: (_id: string, text: string | null | undefined) => ({
    translation: text ? translation.current : null,
    target: text ? 'en' : null,
    requestTranslation: translation.request,
  }),
}));

import { SharedMessageRow, type MessageRowAdapter } from '../SharedMessageRow';

const ORIGINAL = '¿Vienes a la fiesta esta noche?';

function adapter(overrides: Partial<MessageRowAdapter> = {}): MessageRowAdapter {
  const renderBodyText = (text: string) => <p>{text}</p>;
  return {
    message: {},
    messageId: 'm1',
    authorName: 'Ana',
    authorAvatarUrl: '',
    profileUserId: null,
    timestampLabel: 'now',
    contextBlock: null,
    bodyContent: renderBodyText(ORIGINAL),
    attachmentContent: null,
    reactionContent: null,
    isGrouped: false,
    showAvatar: true,
    isEditing: false,
    capabilities: {
      canEdit: false, canDelete: false, canPin: false, canThread: false, canReact: false,
      canReply: false, canForward: false, canSpeak: false, canCopy: true, canMarkUnread: false,
    },
    actionHandlers: { copy: () => {} },
    translatableText: ORIGINAL,
    renderBodyText,
    ...overrides,
  };
}

describe('SharedMessageRow auto-translation', () => {
  it('renders the original when there is no translation', () => {
    translation.current = null;
    render(<SharedMessageRow adapter={adapter()} />);
    expect(screen.getByText(ORIGINAL)).toBeTruthy();
    expect(screen.queryByText(/Translated from/)).toBeNull();
  });

  it('shows the translation with a confidence system line and toggles the original', () => {
    translation.current = { text: 'Are you coming to the party tonight?', from: 'es', to: 'en', confidence: 0.914 };
    render(<SharedMessageRow adapter={adapter()} />);

    expect(screen.getByText('Are you coming to the party tonight?')).toBeTruthy();
    expect(screen.queryByText(ORIGINAL)).toBeNull();
    expect(screen.getByText('Translated from Spanish')).toBeTruthy();
    expect(screen.getByText('91% confidence')).toBeTruthy();
    expect(screen.queryByText(/accura/i)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Show original' }));
    expect(screen.getByText(ORIGINAL)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show translation' }));
    expect(screen.getByText('Are you coming to the party tonight?')).toBeTruthy();
  });

  it('never translates rows that do not opt in with a body renderer', () => {
    translation.current = { text: 'Are you coming to the party tonight?', from: 'es', to: 'en', confidence: 0.9 };
    render(<SharedMessageRow adapter={adapter({ renderBodyText: undefined })} />);
    expect(screen.getByText(ORIGINAL)).toBeTruthy();
    expect(screen.queryByText(/Translated from/)).toBeNull();
  });

  it('offers "Translate to English" in the context menu for skipped messages', () => {
    translation.current = null;
    translation.request.mockClear();
    const { container } = render(<SharedMessageRow adapter={adapter()} />);
    fireEvent.contextMenu(container.firstElementChild!);
    fireEvent.click(screen.getByText('Translate to English'));
    expect(translation.request).toHaveBeenCalledTimes(1);
  });

  it('turns the menu item into Show original once translated, and hides a null confidence', () => {
    translation.current = { text: 'Look at this', from: 'es', to: 'en', confidence: null };
    const { container } = render(<SharedMessageRow adapter={adapter()} />);
    expect(screen.queryByText(/confidence/)).toBeNull();
    fireEvent.contextMenu(container.firstElementChild!);
    expect(screen.queryByText('Translate to English')).toBeNull();
    const menuItems = screen.getAllByRole('button', { name: 'Show original' });
    fireEvent.click(menuItems[menuItems.length - 1]);
    expect(screen.getByText(ORIGINAL)).toBeTruthy();
  });

  it('places the translate item above destructive actions', () => {
    translation.current = null;
    const { container } = render(
      <SharedMessageRow
        adapter={adapter({
          capabilities: { ...adapter().capabilities, canDelete: true },
          actionHandlers: { copy: () => {}, delete: () => {} },
        })}
      />,
    );
    fireEvent.contextMenu(container.firstElementChild!);
    const labels = Array.from(document.body.querySelectorAll('.fixed button')).map((b) => b.textContent);
    expect(labels.indexOf('Translate to English')).toBeLessThan(labels.indexOf('Delete'));
  });

  it('shows Copy Text, Add Cat Reactions and View Cat Reactions, and lists who reacted', () => {
    translation.current = null;
    const { container } = render(
      <SharedMessageRow
        adapter={adapter({
          capabilities: { ...adapter().capabilities, canReact: true },
          actionHandlers: { copy: () => {}, react: () => {} },
          reactionDetails: [{ emoji: '😺', count: 2, users: ['u1', 'u2'] }],
          renderReactionEmoji: (emoji) => <span>{emoji}</span>,
          resolveReactorName: (id) => (id === 'u1' ? 'Ana' : null),
        })}
      />,
    );
    fireEvent.contextMenu(container.firstElementChild!);
    const labels = Array.from(document.body.querySelectorAll('.fixed button')).map((b) => b.textContent);
    expect(labels).toEqual(expect.arrayContaining(['Copy Text', 'Add Cat Reactions', 'View Cat Reactions']));
    expect(labels.indexOf('View Cat Reactions')).toBe(labels.indexOf('Add Cat Reactions') + 1);

    fireEvent.click(screen.getByText('View Cat Reactions'));
    expect(screen.getByText('Cat Reactions')).toBeTruthy();
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Ana', 'Unknown user']);
  });

  it('hides View Cat Reactions when the message has no reactions', () => {
    translation.current = null;
    const { container } = render(
      <SharedMessageRow
        adapter={adapter({
          reactionDetails: [],
          renderReactionEmoji: (emoji) => <span>{emoji}</span>,
          resolveReactorName: () => null,
        })}
      />,
    );
    fireEvent.contextMenu(container.firstElementChild!);
    expect(screen.queryByText('View Cat Reactions')).toBeNull();
  });
});
