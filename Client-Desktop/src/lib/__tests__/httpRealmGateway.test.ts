import { describe, expect, it } from 'vitest';
import { selectRealmsForPlatform } from '../httpRealmGateway';

const gatewayUrl = `https://r-${'a'.repeat(40)}.bridge.catrealm.app`;
const gateway = {
  url: gatewayUrl,
  originalHttpOrigin: 'http://203.0.113.5:3000',
  icon: `${gatewayUrl}/uploads/icon.png`,
};

describe('selectRealmsForPlatform', () => {
  it('hides the gateway copy on desktop when a direct entry exists', () => {
    const direct = { url: 'http://203.0.113.5:3000' };
    const { servers, renamed } = selectRealmsForPlatform([direct, gateway], false);
    expect(servers).toEqual([direct]);
    expect(renamed.get(gatewayUrl)).toBe(direct.url);
  });

  it('matches legacy https IP:port direct entries', () => {
    const legacy = { url: 'https://203.0.113.5:3000' };
    const { servers } = selectRealmsForPlatform([gateway, legacy], false);
    expect(servers).toEqual([legacy]);
  });

  it('turns a gateway-only realm into a direct HTTP realm on desktop', () => {
    const { servers, renamed } = selectRealmsForPlatform([gateway], false);
    expect(servers).toEqual([{
      url: 'http://203.0.113.5:3000',
      originalHttpOrigin: undefined,
      icon: 'http://203.0.113.5:3000/uploads/icon.png',
    }]);
    expect(renamed.get(gatewayUrl)).toBe('http://203.0.113.5:3000');
  });

  it('hides the direct copy on HTTPS pages', () => {
    const direct = { url: 'http://203.0.113.5:3000' };
    const { servers, renamed } = selectRealmsForPlatform([direct, gateway], true);
    expect(servers).toEqual([gateway]);
    expect(renamed.get(direct.url)).toBe(gatewayUrl);
  });

  it('leaves unrelated realms alone', () => {
    const other = [{ url: 'https://realm.example' }, { url: 'http://198.51.100.1:3000' }];
    expect(selectRealmsForPlatform(other, false).servers).toBe(other);
    expect(selectRealmsForPlatform([...other, gateway], true).servers).toEqual([...other, gateway]);
  });
});
