import { selectMobileRealmView } from '../realmPlatformView';

const gatewayUrl = `https://r-${'a'.repeat(40)}.bridge.catrealm.app`;
const directUrl = 'http://203.0.113.5:3000';
const direct = { url: directUrl, name: 'Home', token: 'direct-token' };
const gateway = {
  url: gatewayUrl,
  originalHttpOrigin: directUrl,
  name: 'Home',
  token: 'gateway-token',
};

test('mobile renders one HTTPS gateway entry for a direct and gateway realm pair', () => {
  const view = selectMobileRealmView(
    [direct, gateway],
    [{ type: 'server', url: directUrl }, { type: 'server', url: gatewayUrl }],
    [],
  );

  expect(view.servers).toEqual([gateway]);
  expect(view.layout).toEqual([
    { type: 'server', url: gatewayUrl },
    { type: 'server', url: gatewayUrl },
  ]);
  expect(view.rename(directUrl)).toBe(gatewayUrl);
});

test('mobile rewrites folder membership to the visible gateway URL', () => {
  const view = selectMobileRealmView(
    [gateway, direct],
    [{ type: 'folder', folderId: 'home' }],
    [{ id: 'home', name: 'Home', color: '#7c5cff', isOpen: true, serverUrls: [directUrl] }],
  );

  expect(view.folders?.[0].serverUrls).toEqual([gatewayUrl]);
});

test('unrelated HTTPS realms remain unchanged', () => {
  const servers = [{ url: 'https://realm.example', name: 'Realm', token: 'token' }];
  const view = selectMobileRealmView(servers, undefined, undefined);

  expect(view.servers).toEqual(servers);
  expect(view.rename(servers[0].url)).toBe(servers[0].url);
});
