const test = require('node:test');
const assert = require('node:assert/strict');
const { createAppSecurity, isPasskeyUrl, isOverlayHostAllowed } = require('../appSecurity.cjs');

const indexPath = '/synthetic/CatRealm/dist/index.html';
const appUrl = 'file:///synthetic/CatRealm/dist/index.html';

function createContents(url = appUrl) {
  return { mainFrame: { url }, isDestroyed: () => false, getURL: () => url };
}

test('packaged navigation admits app routes but excludes other local files and remote pages', () => {
  const policy = createAppSecurity({ indexPath, isDev: false });
  assert.equal(policy.isAppUrl(`${appUrl}?standalone=screenshare-wizard#/settings`), true);
  for (const url of ['file:///synthetic/other.html', 'file://other-host/synthetic/CatRealm/dist/index.html', 'http://localhost:5173/', 'http://localhost:42069/', 'https://catrealm.app/', 'https://uploads.catrealm.app/file.html']) {
    assert.equal(policy.isAppUrl(url), false, url);
  }
});

test('development access is limited to the configured origin', () => {
  const policy = createAppSecurity({ indexPath, isDev: true });
  assert.equal(policy.isAppUrl('http://localhost:5173/settings'), true);
  for (const url of [appUrl, 'http://localhost:5174/', 'http://localhost:5173.example.test/', 'http://localhost:5173@example.test/']) {
    assert.equal(policy.isAppUrl(url), false, url);
  }
});

test('privileged IPC rejects unregistered windows, subframes and navigated documents before calling native code', () => {
  const policy = createAppSecurity({ indexPath, isDev: false });
  const main = createContents();
  policy.register(main);
  let invoke;
  let nativeCalls = 0;
  policy.handle({ handle(_channel, callback) { invoke = callback; } }, 'synthetic-capture', (_event, value) => {
    nativeCalls += 1;
    return value;
  });
  assert.equal(invoke({ sender: main, senderFrame: main.mainFrame }, 'allowed'), 'allowed');
  const other = createContents();
  for (const event of [
    { sender: other, senderFrame: other.mainFrame },
    { sender: main, senderFrame: { url: appUrl } },
    { sender: main },
  ]) assert.throws(() => invoke(event), /untrusted application frame/);
  main.mainFrame.url = 'https://catrealm.app/';
  assert.throws(() => invoke({ sender: main, senderFrame: main.mainFrame }), /untrusted application frame/);
  assert.equal(nativeCalls, 1);
});

test('media grants require a registered application main frame', () => {
  const policy = createAppSecurity({ indexPath, isDev: false });
  const main = createContents();
  policy.register(main);
  assert.equal(policy.isMediaRequestAllowed(main, { isMainFrame: true, requestingUrl: appUrl }), true);
  assert.equal(policy.isMediaRequestAllowed(main, { isMainFrame: false, requestingUrl: 'https://example.test/document.pdf' }), false);
  assert.equal(policy.isMediaRequestAllowed(main, { isMainFrame: true, requestingUrl: 'https://catrealm.app/' }), false);
  assert.equal(policy.isMediaRequestAllowed(createContents(), { isMainFrame: true, requestingUrl: appUrl }), false);
  assert.equal(policy.isMediaRequestAllowed(main, {}), false);
});

test('authentication pages are allowed without trusting them as application pages', () => {
  assert.equal(isPasskeyUrl('https://catrealm.app/webauthn/register/synthetic?secret=synthetic'), true);
  for (const url of ['https://catrealm.app/', 'https://catrealm.app.example.test/webauthn/register/synthetic', 'https://catrealm.app@example.test/webauthn/register/synthetic', 'https://auth.catrealm.app:444/webauthn/register/synthetic', 'http://localhost:5173/webauthn/register/synthetic']) {
    assert.equal(isPasskeyUrl(url), false, url);
  }
  assert.equal(isPasskeyUrl('http://localhost:5173/webauthn/register/synthetic', true), true);
});

test('overlay requests require the local listener host, not a rebound external hostname', () => {
  assert.equal(isOverlayHostAllowed('localhost:42069', 42069), true);
  assert.equal(isOverlayHostAllowed('127.0.0.1:42069', 42069), true);
  for (const host of ['overlay.example.test:42069', 'localhost.example.test:42069', 'localhost:1234', undefined]) {
    assert.equal(isOverlayHostAllowed(host, 42069), false);
  }
});
