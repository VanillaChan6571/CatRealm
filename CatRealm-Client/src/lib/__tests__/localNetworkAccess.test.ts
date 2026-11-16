import { describe, expect, it } from 'vitest';
import { isLocalNetworkHostname, shouldDeferPassiveLocalNetworkRequest } from '../localNetworkAccess';

const hostedPage = { protocol: 'https:', hostname: 'catrealm.app' };

describe('local network access', () => {
  it('recognizes common local realm addresses', () => {
    for (const hostname of ['localhost', 'realm.local', 'realm.lan', 'realm.internal', '127.0.0.1', '10.0.0.7', '172.16.0.1', '192.168.1.2', '169.254.1.1', '[::1]', '[fd12::1]', '[fe80::1]', 'realm']) {
      expect(isLocalNetworkHostname(hostname), hostname).toBe(true);
    }
    for (const hostname of ['catrealm.app', '8.8.8.8', '172.32.0.1', '198.51.100.3']) {
      expect(isLocalNetworkHostname(hostname), hostname).toBe(false);
    }
  });

  it('defers passive local requests from the hosted web client', () => {
    expect(shouldDeferPassiveLocalNetworkRequest('https://192.168.1.2:3000', hostedPage)).toBe(true);
    expect(shouldDeferPassiveLocalNetworkRequest('//localhost:3000/icon.png', hostedPage)).toBe(true);
    expect(shouldDeferPassiveLocalNetworkRequest('https://realm.example/icon.png', hostedPage)).toBe(false);
    expect(shouldDeferPassiveLocalNetworkRequest('/icon.png', hostedPage)).toBe(false);
  });

  it('keeps local and desktop clients able to reconnect automatically', () => {
    const target = 'http://192.168.1.2:3000';
    expect(shouldDeferPassiveLocalNetworkRequest(target, { protocol: 'http:', hostname: 'localhost' })).toBe(false);
    expect(shouldDeferPassiveLocalNetworkRequest(target, { ...hostedPage, isDesktop: true })).toBe(false);
  });
});
