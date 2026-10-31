const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture({ platform = 'win32', autoReply = true, missingFiles = false, bareGst = false } = {}) {
  const calls = [];
  let now = 1000;
  const modules = new Map();
  const fakeProcess = {
    platform, cwd: () => 'C:\\app', env: {
      CATREALM_FFMPEG_BIN: 'C:\\ffmpeg\\CatRealm-ffmpeg.exe',
      CATREALM_GSTREAMER_BIN: bareGst ? 'gst-launch-1.0' : 'C:\\runtime\\bin\\gst-launch-1.0.exe',
    },
  };
  const reply = (child, stdout = '', code = 0) => {
    child.stdout.emit('data', Buffer.from(stdout));
    child.emit('close', code);
  };
  const spawn = (command, args, options) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    child.killed = false;
    child.kill = () => { child.killed = true; child.emit('close', 0); };
    calls.push({ command, args, options, child });
    if (autoReply) setImmediate(() => {
      if (command === 'powershell') return reply(child, 'NVIDIA RTX|NVIDIA|10DE\nIntel UHD Graphics|Intel|8086\nVirtual monitor|Other|0000\nNVIDIA RTX|NVIDIA|10de');
      const outputs = { '-buildconf': '--enable-openssl', '-muxers': ' E whip', '-filters': ' ... ddagrab\n ... gfxcapture', '-encoders': ' V..... h264_nvenc\n A..... libopus', '-devices': ' D dshow' };
      reply(child, outputs[args.at(-1)] || 'available');
    });
    return child;
  };
  function load(name) {
    if (modules.has(name)) return modules.get(name);
    const filename = path.resolve(__dirname, '..', name);
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
      module, __dirname: 'C:\\app\\electron', Buffer, setTimeout, clearTimeout,
      Date: class extends Date { static now() { return now; } }, process: fakeProcess,
      require: dependency => {
        if (dependency === 'child_process') return { spawn, spawnSync() { assert.fail('Settings discovery must never call spawnSync'); } };
        if (dependency === 'path') return path.win32;
        if (dependency === 'fs') return { existsSync: candidate => !missingFiles && /\\(?:runtime|ffmpeg)\\/.test(candidate) };
        if (dependency.startsWith('./')) return load(dependency.slice(2));
        return require(dependency);
      },
    }, { filename });
    modules.set(name, module.exports);
    return module.exports;
  }
  return { calls, load, reply, advance: ms => { now += ms; } };
}

test('GPU discovery stays asynchronous, deduplicates simultaneous callers and preserves GPU mapping', async () => {
  const f = fixture();
  const bridge = f.load('whipPublisherBridge.cjs');
  const discover = f.load('screenShareGpuDiscovery.cjs').createScreenShareGpuDiscovery(bridge.availableH264EncodersAsync);
  let finished = false;
  const first = discover().then(value => { finished = true; return value; });
  const second = discover();
  await Promise.resolve();
  assert.equal(finished, false, 'Discovery must yield while drivers are probed');
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.gpus.length, 2);
  assert.equal(a.gpus[0].encoder, 'nvh264enc');
  assert.equal(a.gpus[0].integrated, false);
  assert.equal(a.gpus[1].encoder, 'mfh264enc');
  assert.equal(a.gpus[1].integrated, true);
  assert.equal(a.hasDiscrete, true);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.equal(f.calls.filter(call => call.command === 'powershell').length, 1);
  assert.equal(f.calls.filter(call => call.args.length === 1 && call.args[0].endsWith('h264enc')).length, 3);
  assert.ok(f.calls.find(call => call.args[0] === 'nvh264enc').options.env.GST_PLUGIN_PATH);
  const count = f.calls.length;
  await discover();
  assert.equal(f.calls.length, count, 'Reopening Settings uses the session cache');
});

test('bare GStreamer executable resolution also uses asynchronous version probes', async () => {
  const f = fixture({ bareGst: true });
  const encoders = await f.load('whipPublisherBridge.cjs').availableH264EncodersAsync();
  assert.equal(encoders.length, 3);
  assert.ok(f.calls.some(call => call.command === 'gst-launch-1.0' && call.args[0] === '--version'));
});

test('cold FFmpeg IPC shares startup warming and never falls back to synchronous probes', async () => {
  const f = fixture();
  const bridge = f.load('whipPublisherBridge.cjs');
  const handlers = new Map();
  const main = fs.readFileSync(path.resolve(__dirname, '../main.cjs'), 'utf8');
  const registration = main.match(/handleAppIpc\('native-whip-publisher-support',[\s\S]*?\n\)\);/)[0];
  vm.runInNewContext(registration, { handleAppIpc: (name, handler) => handlers.set(name, handler), whipPublisherBridge: bridge });
  const warm = bridge.warmSupport();
  const fromSettings = handlers.get('native-whip-publisher-support')({}, {});
  const [a, b] = await Promise.all([warm, fromSettings]);
  assert.equal(a.ok, true); assert.equal(b.ok, true);
  assert.equal(f.calls.length, 6, 'Only one version/buildconf/four-capability sequence');
  await bridge.getSupportAsync();
  assert.equal(f.calls.length, 6);
  await handlers.get('native-whip-publisher-support')({}, { forceRefresh: true });
  assert.equal(f.calls.length, 12, 'Explicit refresh is still supported asynchronously');
});

test('missing runtimes settle, are negatively cached, and can be retried later', async () => {
  const f = fixture({ missingFiles: true, autoReply: false });
  const bridge = f.load('whipPublisherBridge.cjs');
  const pending = bridge.getSupportAsync();
  for (let i = 0; i < 3; i++) {
    await new Promise(setImmediate);
    const call = f.calls.at(-1);
    call.child.emit('error', new Error('ENOENT'));
  }
  assert.equal((await pending).ok, false);
  const count = f.calls.length;
  await bridge.getSupportAsync();
  assert.equal(f.calls.length, count);
  assert.equal((await bridge.availableH264EncodersAsync()).length, 0);

  const { createCachedProbe } = f.load('hardwareProbe.cjs');
  let attempts = 0;
  const probe = createCachedProbe(async () => { attempts++; return []; }, result => result.length > 0);
  await Promise.all([probe(), probe()]); await probe();
  assert.equal(attempts, 1);
  f.advance(300001); await probe();
  assert.equal(attempts, 2);
});

test('non-Windows clients do not spawn Windows probes', async () => {
  const f = fixture({ platform: 'linux' });
  const bridge = f.load('whipPublisherBridge.cjs');
  const discover = f.load('screenShareGpuDiscovery.cjs').createScreenShareGpuDiscovery(bridge.availableH264EncodersAsync);
  assert.equal((await discover()).gpus.length, 0);
  assert.equal((await bridge.getSupportAsync()).ok, false);
  assert.equal((await bridge.availableH264EncodersAsync()).length, 0);
  assert.equal(f.calls.length, 0);
});

test('hung driver probes time out without blocking timers and ignore late successful exits', async () => {
  const f = fixture({ autoReply: false });
  const { runHardwareProbe } = f.load('hardwareProbe.cjs');
  let heartbeat = false;
  const pending = runHardwareProbe('hung-driver', [], { timeoutMs: 30 });
  await new Promise(resolve => setTimeout(() => { heartbeat = true; resolve(); }, 1));
  assert.equal(heartbeat, true);
  const result = await pending;
  assert.equal(result.ok, false); assert.equal(result.error, 'timeout');
  assert.equal(f.calls[0].child.killed, true);
  f.reply(f.calls[0].child, 'late output', 0);
  assert.equal(result.stdout, '');
});

test('spawn errors and oversized probe output are bounded', async () => {
  const f = fixture({ autoReply: false });
  const { runHardwareProbe } = f.load('hardwareProbe.cjs');
  const pending = runHardwareProbe('broken-driver');
  f.calls[0].child.emit('error', new Error('ENOENT'));
  assert.equal((await pending).error, 'ENOENT');
  const noisy = runHardwareProbe('noisy-driver');
  f.reply(f.calls[1].child, 'x'.repeat(2 * 1024 * 1024));
  assert.equal((await noisy).stdout.length, 1024 * 1024);
});
