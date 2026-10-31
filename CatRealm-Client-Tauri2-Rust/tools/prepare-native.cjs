// Platform-aware dispatcher for the native prep steps. The app-audio helper and
// bundled GStreamer runtime are Windows-only; Linux/macOS builds ship without them.
const { execSync } = require('child_process');
const path = require('path');

if (process.platform !== 'win32') {
  console.log(`[prepare-native] Skipping Windows-only native staging (app-audio helper, GStreamer runtime) on ${process.platform}.`);
  process.exit(0);
}

const projectRoot = path.resolve(__dirname, '..');
for (const step of ['prepare:app-audio', 'prepare:gstreamer', 'prepare:gstreamer-stage']) {
  execSync(`npm run ${step}`, { stdio: 'inherit', cwd: projectRoot });
}
