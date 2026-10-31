const { spawn } = require('child_process');

// Hardware/driver queries must never use spawnSync on Electron's main thread.
function runHardwareProbe(command, args = [], { timeoutMs = 8000, env } = {}) {
  return new Promise((resolve) => {
    let child;
    let timer;
    let settled = false;
    let stdout = '';
    let stderr = '';
    const finish = (ok, error = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok, stdout, stderr, error });
    };
    try {
      child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, ...(env ? { env } : {}) });
      // Bound diagnostic output even if a broken driver floods the pipe.
      child.stdout?.on('data', chunk => { if (!settled) stdout = (stdout + chunk.toString('utf8')).slice(0, 1024 * 1024); });
      child.stderr?.on('data', chunk => { if (!settled) stderr = (stderr + chunk.toString('utf8')).slice(0, 1024 * 1024); });
      child.on('error', error => finish(false, error.message));
      child.on('close', code => finish(code === 0));
      timer = setTimeout(() => {
        finish(false, 'timeout');
        try { child.kill('SIGKILL'); } catch { /* already exited */ }
      }, timeoutMs);
    } catch (error) {
      finish(false, error instanceof Error ? error.message : String(error));
    }
  });
}

// Successful discoveries last for this app session. Failures get a cooldown
// instead of permanently hiding hardware or restarting probes on every mount.
function createCachedProbe(probe, isSuccess, retryAfterMs = 5 * 60_000) {
  let cached;
  let checkedAt = 0;
  let inflight = null;
  return function getResult() {
    if (inflight) return inflight;
    if (cached !== undefined && (isSuccess(cached) || Date.now() - checkedAt < retryAfterMs)) {
      return Promise.resolve(cached);
    }
    inflight = Promise.resolve().then(probe).then(result => {
      cached = result;
      checkedAt = Date.now();
      return result;
    }).finally(() => { inflight = null; });
    return inflight;
  };
}

module.exports = { runHardwareProbe, createCachedProbe };
