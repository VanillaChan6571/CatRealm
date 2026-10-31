import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { TheaterPresenceBadge } from '../TheaterPresenceBadge';
import { isTheaterVoiceDisconnected } from '../../../lib/theaterPresence';

afterEach(cleanup);
describe('theater device and voice presence', () => {
  it('shows a mobile icon, orange mute icon, and Not In Call for a video-only mobile viewer', () => {
    const { container } = render(<TheaterPresenceBadge user={{ clientType: 'mobile', voiceConnected: false }} />);
    expect(screen.getByLabelText('Mobile')).toBeTruthy();
    expect(screen.getByText('Not In Call')).toBeTruthy();
    expect(container.querySelector('.text-orange-400 .lucide-mic-off')).toBeTruthy();
  });
  it('removes Not In Call upon voice connection and restores it on voice leave', () => {
    const view = render(<TheaterPresenceBadge user={{ clientType: 'mobile', voiceConnected: false }} />);
    view.rerender(<TheaterPresenceBadge user={{ clientType: 'mobile', voiceConnected: true }} />);
    expect(screen.getByLabelText('Mobile')).toBeTruthy();
    expect(screen.queryByText('Not In Call')).toBeNull();
    view.rerender(<TheaterPresenceBadge user={{ clientType: 'mobile', voiceConnected: false }} />);
    expect(screen.getByText('Not In Call')).toBeTruthy();
  });
  it('does not infer disconnected voice for legacy or desktop clients', () => {
    const view = render(<TheaterPresenceBadge user={{ clientType: 'mobile' }} />);
    expect(screen.queryByText('Not In Call')).toBeNull();
    expect(isTheaterVoiceDisconnected({})).toBe(false);
    view.rerender(<TheaterPresenceBadge user={{ clientType: 'desktop' }} />);
    expect(view.container.textContent).toBe('');
    expect(screen.queryByLabelText('Mobile')).toBeNull();
  });
});
