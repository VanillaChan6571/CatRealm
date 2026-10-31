const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { AppUpdater } = require('electron-updater/out/AppUpdater');

const source = fs.readFileSync(path.join(__dirname, '..', 'main.cjs'), 'utf8');

function sourceBetween(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `Missing updater source: ${start}`);
  return source.slice(from, to);
}

function fixture(currentVersion = '1.8.8') {
  // Use the installed updater's real channel setter and version comparison,
  // without constructing its network client or reading an installed profile.
  const updater = Object.create(AppUpdater.prototype);
  updater.currentVersion = currentVersion;
  updater.isUpdateSupported = () => true;
  updater.isUserWithinRollout = () => true;
  const handlers = new Map();
  const context = vm.createContext({
    SAFE_UPDATE_CHANNEL_ID: /^[a-z0-9][a-z0-9._-]{0,63}$/,
    canAutoUpdate: true,
    autoUpdater: updater,
    updateChannel: 'latest',
    updateDownloaded: false,
    allowStableDowngradeOverride: false,
    handleAppIpc: (name, handler) => handlers.set(name, handler),
    queueUpdateAction() {},
    checkForUpdatesNow: async () => ({ ok: true }),
  });
  vm.runInContext(sourceBetween('function applyUpdateChannel(', '\nfunction formatQueuedUpdateMessage('), context);
  vm.runInContext(sourceBetween("handleAppIpc('downgrade-client'", "\nhandleAppIpc('clear-and-retry-update'"), context);
  return {
    updater,
    apply: channel => context.applyUpdateChannel(channel),
    downgrade: () => handlers.get('downgrade-client')(),
    available: version => updater.isUpdateAvailable({ version }),
  };
}

test('restoring Dev after installing stable never offers an older release or prerelease', async () => {
  const f = fixture();
  f.apply('dev');
  assert.equal(f.updater.channel, 'dev');
  assert.equal(f.updater.allowPrerelease, true);
  assert.equal(f.updater.allowDowngrade, false);
  assert.equal(await f.available('1.8.8-dev.712'), false);
  assert.equal(await f.available('1.8.7'), false);
  assert.equal(await f.available('1.8.8'), false);
  assert.equal(await f.available('1.8.9-dev.1'), true);
});

test('every ordinary channel selection resets the updater library downgrade default', async () => {
  const f = fixture();
  for (const channel of ['latest', 'dev', 'custom-preview', 'latest']) {
    f.apply(channel);
    assert.equal(f.updater.allowDowngrade, false, channel);
    assert.equal(await f.available('1.8.7'), false, channel);
  }
  assert.equal(f.updater.allowPrerelease, false);
});

test('new Dev builds and graduation from prerelease to stable remain available', async () => {
  const f = fixture('1.8.8-dev.711');
  f.apply('dev');
  assert.equal(await f.available('1.8.8-dev.712'), true);
  assert.equal(await f.available('1.8.8-dev.710'), false);
  f.apply('latest');
  assert.equal(await f.available('1.8.8'), true);
});

test('the explicit downgrade command alone permits returning to an older stable release', async () => {
  const f = fixture('1.8.9-dev.1');
  f.apply('dev');
  assert.equal(await f.available('1.8.8'), false);
  assert.equal((await f.downgrade()).ok, true);
  assert.equal(f.updater.channel, 'latest');
  assert.equal(f.updater.allowPrerelease, false);
  assert.equal(f.updater.allowDowngrade, true);
  assert.equal(await f.available('1.8.8'), true);
  f.apply('dev');
  assert.equal(f.updater.allowDowngrade, false);
  assert.equal(await f.available('1.8.8-dev.712'), false);
});
