// Run against a running Metro server or its public proxy; no device required.
// HTTP 200 alone is insufficient: an SPA fallback can return HTML for an MP3.
/* global process, URL, fetch, AbortSignal, Buffer, console */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';

const base = process.argv[2];
if (!base || !/^https?:\/\//.test(base)) {
  throw new Error('Usage: node scripts/check-dev-audio-assets.mjs https://catrealm.app');
}
const directory = new URL('../assets/sounds/iOS/', import.meta.url);
const files = (await readdir(directory)).filter((name) => name.endsWith('.mp3'));
assert.ok(files.length > 0, 'Expected iOS sound fixtures');

for (const name of files) {
  const expected = await readFile(new URL(name, directory));
  const hash = createHash('md5').update(expected).digest('hex');
  // Match the exact query shape emitted by the current Metro asset resolver.
  const current = `/assets/?unstable_path=.%2Fassets%2Fsounds%2FiOS/${encodeURIComponent(name)}?platform=ios&hash=${hash}`;
  const legacy = `/assets/assets/sounds/iOS/${encodeURIComponent(name)}?platform=ios&hash=${hash}`;
  for (const path of [current, legacy]) {
    const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(20_000) });
    assert.equal(response.status, 200, `${name}: ${path}`);
    assert.match(response.headers.get('content-type') ?? '', /^audio\//i, `${name}: expected audio, not an HTML fallback`);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), expected, `${name}: served bytes differ from the source asset`);
  }
  const range = await fetch(new URL(current, base), {
    headers: { Range: 'bytes=0-1023' }, signal: AbortSignal.timeout(20_000),
  });
  assert.equal(range.status, 206, `${name}: AVPlayer range request`);
  assert.equal(range.headers.get('content-range'), `bytes 0-1023/${expected.length}`);
  assert.deepEqual(Buffer.from(await range.arrayBuffer()), expected.subarray(0, 1024));
  console.log(`PASS ${name}: current/legacy URLs and byte ranges`);
}
console.log(`Verified ${files.length} iOS sounds through ${new URL(base).origin}`);
