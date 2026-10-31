const fs = require('fs');
const path = require('path');

function getHelperCandidates() {
  const names = ['CatRealmAppAudioCapture.exe'];
  const unpackedDir = __dirname.includes(`${path.sep}app.asar${path.sep}`)
    ? __dirname.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`)
    : null;
  const roots = [
    ...(unpackedDir ? [
      path.join(unpackedDir, 'native', 'win-app-audio', 'bin'),
      path.join(unpackedDir, 'native', 'win-app-audio'),
    ] : []),
    path.join(process.resourcesPath || '', 'app.asar.unpacked', 'electron', 'native', 'win-app-audio', 'bin'),
    path.join(process.resourcesPath || '', 'app.asar.unpacked', 'electron', 'native', 'win-app-audio'),
    path.join(process.resourcesPath || '', 'electron', 'native', 'win-app-audio', 'bin'),
    path.join(__dirname, 'native', 'win-app-audio', 'bin'),
    path.join(__dirname, 'native', 'win-app-audio'),
  ];
  return roots.flatMap((root) => names.map((name) => path.join(root, name)));
}

function getHelperPath() {
  for (const candidate of getHelperCandidates()) {
    try {
      if (/[\\/]app\.asar[\\/]/.test(candidate)) continue;
      if (candidate && fs.existsSync(candidate)) return candidate;
    } catch {
      // Keep checking fallbacks.
    }
  }
  return null;
}

function getCapabilities() {
  if (process.platform !== 'win32') {
    return {
      available: false,
      reason: 'Windows application audio capture is only supported on Windows desktop builds.',
    };
  }

  const helperPath = getHelperPath();
  if (helperPath) {
    return {
      available: true,
      helperPath,
    };
  }

  return {
    available: false,
    reason: 'The Windows native application audio capture module is not bundled in this build.',
  };
}

module.exports = {
  getCapabilities,
  getHelperPath,
};
