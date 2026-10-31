import { describe, expect, it } from 'vitest';
import { buildReactivePack, parseReactivePack, sha256Hex, SHARED_PACK_MAX_BYTES } from '../reactiveAvatarShare/pack';
import { deriveAvatarShareKey, openFromFriend, sealForFriend, shareAad } from '../reactiveAvatarShare/crypto';

const bytes = (...values: number[]) => new Uint8Array(values);
const secret = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));

describe('reactive avatar pack format', () => {
  it('round-trips motion and per-state bytes', () => {
    const pack = buildReactivePack('bounce', { idle: bytes(1, 2, 3), speaking: bytes(4, 5), deafened: bytes(9) });
    const parsed = parseReactivePack(pack);
    expect(parsed?.motion).toBe('bounce');
    expect([...(parsed?.images.idle ?? [])]).toEqual([1, 2, 3]);
    expect([...(parsed?.images.speaking ?? [])]).toEqual([4, 5]);
    expect(parsed?.images.muted).toBeUndefined();
    expect([...(parsed?.images.deafened ?? [])]).toEqual([9]);
  });

  it('rejects bad magic, out-of-bounds ranges, unknown states and oversize packs', () => {
    const good = buildReactivePack('pop', { idle: bytes(1, 2, 3) });
    const badMagic = good.slice();
    badMagic[0] = 0;
    expect(parseReactivePack(badMagic)).toBeNull();
    expect(parseReactivePack(good.subarray(0, good.byteLength - 1))).toBeNull();

    const forge = (manifest: unknown, payload = bytes(1, 2, 3)) => {
      const json = new TextEncoder().encode(JSON.stringify(manifest));
      const out = new Uint8Array(9 + json.byteLength + payload.byteLength);
      out.set([0x43, 0x52, 0x52, 0x50, 1]);
      new DataView(out.buffer).setUint32(5, json.byteLength);
      out.set(json, 9);
      out.set(payload, 9 + json.byteLength);
      return out;
    };
    expect(parseReactivePack(forge({ motion: 'bounce', states: { idle: { offset: 2, length: 5 } } }))).toBeNull();
    expect(parseReactivePack(forge({ motion: 'bounce', states: { idle: { offset: -1, length: 1 } } }))).toBeNull();
    expect(parseReactivePack(forge({ motion: 'bounce', states: { evil: { offset: 0, length: 1 } } }))).toBeNull();
    expect(parseReactivePack(forge({ motion: 'spin', states: { idle: { offset: 0, length: 1 } } }))).toBeNull();
    expect(parseReactivePack(forge({ motion: 'bounce', states: {} }))).toBeNull();
    expect(parseReactivePack(new Uint8Array(SHARED_PACK_MAX_BYTES + 1))).toBeNull();
  });

  it('hashes deterministically', async () => {
    const pack = buildReactivePack('none', { idle: bytes(1) });
    expect(await sha256Hex(pack)).toBe(await sha256Hex(pack.slice()));
    expect(await sha256Hex(pack)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('reactive avatar friend encryption', () => {
  it('opens only for the same key, kind, sender, receiver and hash', async () => {
    const key = await deriveAvatarShareKey(secret, 'conv-1');
    const plaintext = bytes(10, 20, 30);
    const sealed = await sealForFriend(key, plaintext, shareAad('pack', 'alice', 'bob', 'h1'));

    expect([...(await openFromFriend(key, sealed, shareAad('pack', 'alice', 'bob', 'h1')) ?? [])]).toEqual([10, 20, 30]);
    // Reflected back, readdressed, relabelled or swapped for another pack: all fail.
    expect(await openFromFriend(key, sealed, shareAad('pack', 'bob', 'alice', 'h1'))).toBeNull();
    expect(await openFromFriend(key, sealed, shareAad('pack', 'alice', 'carol', 'h1'))).toBeNull();
    expect(await openFromFriend(key, sealed, shareAad('offer', 'alice', 'bob', 'h1'))).toBeNull();
    expect(await openFromFriend(key, sealed, shareAad('pack', 'alice', 'bob', 'h2'))).toBeNull();

    const otherConversation = await deriveAvatarShareKey(secret, 'conv-2');
    expect(await openFromFriend(otherConversation, sealed, shareAad('pack', 'alice', 'bob', 'h1'))).toBeNull();

    const tampered = sealed.slice();
    tampered[tampered.length - 1] ^= 1;
    expect(await openFromFriend(key, tampered, shareAad('pack', 'alice', 'bob', 'h1'))).toBeNull();
  });
});
