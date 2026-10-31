import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MentionProvider, MentionText } from '../mentions';

const users = [{ id: 'u1', username: 'bob' }];
const roles = [{ id: 'r1', name: 'Mods', color: '#ff0000' }];

const channels = [{ id: 'c1', name: 'general' }];

function renderWithMentions(text: string, withChannels = true) {
  return render(
    <MentionProvider users={users} roles={roles} channels={withChannels ? channels : null} everyoneAlias="@everyone">
      <MentionText text={text} />
    </MentionProvider>
  );
}

describe('MentionText', () => {
  it('turns known users and roles into pills, case-insensitively', () => {
    renderWithMentions('hey @BOB and @mods, also @everyone.');
    expect(screen.getByRole('button', { name: '@bob' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '@Mods' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '@everyone' })).toBeTruthy();
  });

  it('keeps trailing punctuation and unknown names as plain text', () => {
    const { container } = renderWithMentions('thanks @bob. ping @nobody or mail me@bob');
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(container.textContent).toBe('thanks @bob. ping @nobody or mail me@bob');
  });

  it('resolves <@id> to users or roles and <#id> to channels', () => {
    const { container } = renderWithMentions('<@u1> <@r1> see <#c1> and <#gone>');
    expect(container.textContent).toBe('@bob @Mods see #general and #deleted-channel');
    expect(screen.getByRole('button', { name: '#general' })).toBeTruthy();
  });

  it('leaves channel and unknown ID tokens as typed outside servers', () => {
    const { container } = renderWithMentions('<#c1> <@nope>', false);
    expect(container.textContent).toBe('<#c1> <@nope>');
  });

  it('renders plain text when there is no mention context', () => {
    render(<MentionText text="hi @bob" />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
