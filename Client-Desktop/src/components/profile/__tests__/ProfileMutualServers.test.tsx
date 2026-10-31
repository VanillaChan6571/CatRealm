import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useServerStore, type ServerEntry } from '../../../stores/serverStore';
import { ProfileMutualServers } from '../ProfileMutualServers';

const responses: Record<string, { id: string; isMember?: boolean } | null> = {
  'https://a.test': { id: 'local-a', isMember: true },
  'https://b.test': { id: 'local-b', isMember: false }, // left the realm
  'https://c.test': null, // never joined (404)
  'https://d.test': { id: 'local-d' }, // older realm without isMember
};

vi.mock('../../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/api')>()),
  createApi: (url: string) => ({
    get: () => (responses[url] ? Promise.resolve({ data: responses[url] }) : Promise.reject(new Error('404'))),
  }),
}));

function server(url: string, name: string): ServerEntry {
  return { url, name, token: 't', info: {} } as ServerEntry;
}

describe('ProfileMutualServers', () => {
  it('lists only realms where the person is still a member', async () => {
    useServerStore.setState({
      servers: [server('https://a.test', 'Alpha'), server('https://b.test', 'Bravo'), server('https://c.test', 'Charlie'), server('https://d.test', 'Delta')],
    });
    render(<ProfileMutualServers centralId="central-1" />);
    expect(await screen.findByText('Alpha')).toBeTruthy();
    expect(screen.getByText('Delta')).toBeTruthy();
    expect(screen.queryByText('Bravo')).toBeNull();
    expect(screen.queryByText('Charlie')).toBeNull();
    expect(screen.getByText('Mutual Servers — 2')).toBeTruthy();
  });
});
