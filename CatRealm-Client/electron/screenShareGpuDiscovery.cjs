const { runHardwareProbe, createCachedProbe } = require('./hardwareProbe.cjs');

function adapterVendor(adapter) {
  const text = `${adapter.compat} ${adapter.name}`.toLowerCase();
  if (adapter.ven === '10de' || text.includes('nvidia')) return 'nvidia';
  if (adapter.ven === '1002' || text.includes('advanced micro') || text.includes('amd') || text.includes('radeon')) return 'amd';
  if (adapter.ven === '8086' || text.includes('intel')) return 'intel';
  return 'other';
}

function isIntegratedGpu(vendor, name) {
  const value = (name || '').toLowerCase().trim();
  if (vendor === 'intel') return !/\barc\b/.test(value);
  if (vendor === 'amd') return /graphics\s*$/.test(value);
  return false;
}

function createScreenShareGpuDiscovery(availableEncoders, platform = process.platform) {
  const listVideoAdapters = createCachedProbe(async () => {
    const script = "Get-CimInstance Win32_VideoController | ForEach-Object { $v = if ($_.PNPDeviceID -match 'VEN_([0-9A-Fa-f]{4})') { $matches[1] } else { '' }; \"$($_.Name)|$($_.AdapterCompatibility)|$v\" }";
    const result = await runHardwareProbe('powershell', ['-NoProfile', '-NonInteractive', '-Command', script]);
    if (!result.ok) return [];
    return result.stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
      const [name, compat, ven] = line.split('|');
      return { name: name || 'GPU', compat: compat || '', ven: (ven || '').toLowerCase() };
    });
  }, adapters => adapters.length > 0);

  return async function listScreenShareGpus() {
    if (platform !== 'win32') return { gpus: [], encoders: [], hasDiscrete: false };
    // Both operations are asynchronous and deduplicated, including cold-start
    // requests from Settings while startup warming is still running.
    const [available, adapters] = await Promise.all([availableEncoders(), listVideoAdapters()]);
    const preferred = { nvidia: 'nvh264enc', amd: 'amfh264enc', intel: 'mfh264enc' };
    const seen = new Set();
    const gpus = [];
    for (const adapter of adapters) {
      const vendor = adapterVendor(adapter);
      if (vendor === 'other') continue;
      let encoder = preferred[vendor];
      if (!available.includes(encoder)) encoder = available.includes('mfh264enc') ? 'mfh264enc' : null;
      if (!encoder) continue;
      const id = `${vendor}:${adapter.name}`;
      if (seen.has(id)) continue;
      seen.add(id);
      gpus.push({ id, label: adapter.name, vendor, encoder, integrated: isIntegratedGpu(vendor, adapter.name) });
    }
    return { gpus, encoders: available, hasDiscrete: gpus.some(gpu => !gpu.integrated) };
  };
}

module.exports = { createScreenShareGpuDiscovery };
