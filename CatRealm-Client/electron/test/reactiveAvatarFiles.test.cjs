const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  MAX_IMAGE_BYTES,
  createReactiveAvatarFiles,
  isImageId,
  sniffImage,
  validateImage,
} = require('../reactiveAvatarFiles.cjs');

function png(width, height, totalBytes = 64) {
  const buf = Buffer.alloc(totalBytes);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12, 'ascii');
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

function gif(width, height) {
  const buf = Buffer.alloc(64);
  buf.write('GIF89a', 0, 'ascii');
  buf.writeUInt16LE(width, 6);
  buf.writeUInt16LE(height, 8);
  return buf;
}

function webpVp8x(width, height) {
  const buf = Buffer.alloc(64);
  buf.write('RIFF', 0, 'ascii');
  buf.write('WEBP', 8, 'ascii');
  buf.write('VP8X', 12, 'ascii');
  buf.writeUIntLE(width - 1, 24, 3);
  buf.writeUIntLE(height - 1, 27, 3);
  return buf;
}

function webpVp8l(width, height) {
  const buf = Buffer.alloc(64);
  buf.write('RIFF', 0, 'ascii');
  buf.write('WEBP', 8, 'ascii');
  buf.write('VP8L', 12, 'ascii');
  buf[20] = 0x2f;
  buf.writeUInt32LE(((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14), 21);
  return buf;
}

test('sniffs dimensions from PNG, GIF and WebP headers', () => {
  assert.deepEqual(sniffImage(png(300, 200)), { ext: 'png', width: 300, height: 200 });
  assert.deepEqual(sniffImage(gif(128, 64)), { ext: 'gif', width: 128, height: 64 });
  assert.deepEqual(sniffImage(webpVp8x(512, 256)), { ext: 'webp', width: 512, height: 256 });
  assert.deepEqual(sniffImage(webpVp8l(100, 90)), { ext: 'webp', width: 100, height: 90 });
});

function ebml(id, payload) {
  const idBytes = [];
  for (let v = id; v > 0; v = Math.floor(v / 256)) idBytes.unshift(v & 0xff);
  const size = payload.length;
  // 8-byte size vint: 0x01 marker followed by the 7-byte length.
  const sizeBytes = [0x01, 0, 0, 0, 0, 0, 0, 0];
  for (let i = 7, v = size; i > 0; i--, v = Math.floor(v / 256)) sizeBytes[i] = v & 0xff;
  return Buffer.concat([Buffer.from(idBytes), Buffer.from(sizeBytes), payload]);
}

function webm(width, height, docType = 'webm') {
  const uint = (id, v) => ebml(id, Buffer.from([(v >> 8) & 0xff, v & 0xff]));
  const header = ebml(0x1a45dfa3, ebml(0x4282, Buffer.from(docType)));
  const video = ebml(0xe0, Buffer.concat([uint(0xb0, width), uint(0xba, height)]));
  const segment = ebml(0x18538067, ebml(0x1654ae6b, ebml(0xae, Buffer.concat([ebml(0xd7, Buffer.from([1])), video]))));
  return Buffer.concat([header, segment]);
}

test('reads WebM dimensions from the EBML track header', () => {
  assert.deepEqual(sniffImage(webm(512, 384)), { ext: 'webm', width: 512, height: 384 });
  assert.equal(sniffImage(webm(512, 384, 'matroska')), null);
  assert.deepEqual(validateImage(webm(4096, 64)), { ok: false, error: 'bad-dimensions' });
  assert.equal(isImageId(`${'b'.repeat(64)}.webm`), true);
});

test('rejects SVG, unknown types, oversize files and oversize dimensions', () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  assert.deepEqual(validateImage(svg), { ok: false, error: 'unsupported-type' });
  assert.deepEqual(validateImage(Buffer.alloc(0)), { ok: false, error: 'empty' });
  assert.deepEqual(validateImage(png(4096, 64)), { ok: false, error: 'bad-dimensions' });
  assert.deepEqual(validateImage(png(0, 64)), { ok: false, error: 'bad-dimensions' });
  assert.deepEqual(validateImage(png(64, 64, 4096), 1024), { ok: false, error: 'too-large' });
  assert.equal(MAX_IMAGE_BYTES >= 64 * 1024 * 1024, true);
  assert.deepEqual(validateImage(png(2048, 2048)), { ok: true, ext: 'png' });
});

test('only accepts content-addressed image ids', () => {
  assert.equal(isImageId(`${'a'.repeat(64)}.png`), true);
  for (const bad of [`${'a'.repeat(64)}.svg`, '../secret.png', `${'A'.repeat(64)}.png`, 'x.png', null]) {
    assert.equal(isImageId(bad), false);
  }
});

test('keeps files another owner (e.g. a dev build) still references', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reactive-avatars-'));
  try {
    const files = createReactiveAvatarFiles(dir);
    const installed = files.save(png(16, 16), { owner: 'file://' });
    const dev = files.save(gif(16, 16), { owner: 'http://localhost:5173' });
    // The installed app prunes with only its own art: the dev build's file survives.
    assert.equal(files.prune('file://', [installed.id]), 0);
    assert.ok(files.read(dev.id));
    assert.equal(files.prune('http://localhost:5173', []), 1);
    assert.equal(files.read(dev.id), null);
    assert.ok(files.read(installed.id));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('applies the smaller caps to received art', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reactive-avatars-'));
  try {
    const files = createReactiveAvatarFiles(dir);
    assert.deepEqual(files.save(png(2048, 2048), { received: true }), { ok: false, error: 'bad-dimensions' });
    assert.equal(files.save(png(2048, 2048)).ok, true);
    assert.equal(files.save(png(1024, 1024), { received: true }).ok, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('saves by content hash, reads back, and prunes unreferenced files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reactive-avatars-'));
  try {
    const files = createReactiveAvatarFiles(dir);
    const first = files.save(png(32, 32));
    const second = files.save(gif(32, 32));
    assert.equal(first.ok && second.ok, true);
    assert.match(first.id, /^[0-9a-f]{64}\.png$/);
    assert.deepEqual(files.save(png(32, 32)), first);
    assert.equal(files.read(first.id).mime, 'image/png');
    assert.equal(files.read('../escape.png'), null);

    assert.equal(files.prune('default', [first.id]), 1);
    assert.ok(files.read(first.id));
    assert.equal(files.read(second.id), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
