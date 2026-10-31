/**
 * Cat Lab — reactive avatar pack wire format (what friends / approved
 * strangers receive in a shared call).
 *
 *   "CRRP" | version u8 | manifest length u32 BE | manifest JSON | image bytes
 *
 * The manifest lists each state's byte range in the payload. Everything is
 * bounds-checked here; every image is additionally re-validated by its magic
 * bytes in the main process before it is stored or shown in OBS.
 */
import { REACTIVE_AVATAR_MOTIONS, REACTIVE_AVATAR_STATES, type ReactiveAvatarMotion, type ReactiveAvatarState } from '../../stores/reactiveAvatarStore';

/** Largest pack we send or accept: four compressed states plus headroom. */
export const SHARED_PACK_MAX_BYTES = 12 * 1024 * 1024;
const MAGIC = [0x43, 0x52, 0x52, 0x50]; // "CRRP"
const FORMAT_VERSION = 1;
const HEADER_BYTES = 9;
const MAX_MANIFEST_BYTES = 2048;

export type ReactivePackManifest = {
  motion: ReactiveAvatarMotion;
  states: Partial<Record<ReactiveAvatarState, { offset: number; length: number }>>;
};

export type ParsedReactivePack = {
  motion: ReactiveAvatarMotion;
  images: Partial<Record<ReactiveAvatarState, Uint8Array>>;
};

export function buildReactivePack(
  motion: ReactiveAvatarMotion,
  images: Partial<Record<ReactiveAvatarState, Uint8Array>>,
): Uint8Array {
  const states: ReactivePackManifest['states'] = {};
  let offset = 0;
  const parts: Uint8Array[] = [];
  for (const state of REACTIVE_AVATAR_STATES) {
    const bytes = images[state];
    if (!bytes || bytes.byteLength === 0) continue;
    states[state] = { offset, length: bytes.byteLength };
    parts.push(bytes);
    offset += bytes.byteLength;
  }
  const manifest = new TextEncoder().encode(JSON.stringify({ motion, states } satisfies ReactivePackManifest));
  const out = new Uint8Array(HEADER_BYTES + manifest.byteLength + offset);
  out.set(MAGIC, 0);
  out[4] = FORMAT_VERSION;
  new DataView(out.buffer).setUint32(5, manifest.byteLength);
  out.set(manifest, HEADER_BYTES);
  let cursor = HEADER_BYTES + manifest.byteLength;
  for (const part of parts) {
    out.set(part, cursor);
    cursor += part.byteLength;
  }
  return out;
}

/** Returns the parsed pack, or null for anything malformed or oversized. */
export function parseReactivePack(bytes: Uint8Array): ParsedReactivePack | null {
  if (bytes.byteLength < HEADER_BYTES || bytes.byteLength > SHARED_PACK_MAX_BYTES) return null;
  if (MAGIC.some((b, i) => bytes[i] !== b) || bytes[4] !== FORMAT_VERSION) return null;
  const manifestLength = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(5);
  if (manifestLength === 0 || manifestLength > MAX_MANIFEST_BYTES || HEADER_BYTES + manifestLength > bytes.byteLength) return null;

  let manifest: unknown;
  try {
    manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(HEADER_BYTES, HEADER_BYTES + manifestLength)));
  } catch {
    return null;
  }
  if (!manifest || typeof manifest !== 'object') return null;
  const { motion, states } = manifest as Partial<ReactivePackManifest>;
  if (typeof motion !== 'string' || !(REACTIVE_AVATAR_MOTIONS as readonly string[]).includes(motion)) return null;
  if (!states || typeof states !== 'object') return null;

  const payload = bytes.subarray(HEADER_BYTES + manifestLength);
  const images: ParsedReactivePack['images'] = {};
  for (const [state, range] of Object.entries(states)) {
    if (!(REACTIVE_AVATAR_STATES as readonly string[]).includes(state)) return null;
    const { offset, length } = (range ?? {}) as { offset?: unknown; length?: unknown };
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length)) return null;
    if ((offset as number) < 0 || (length as number) <= 0 || (offset as number) + (length as number) > payload.byteLength) return null;
    images[state as ReactiveAvatarState] = payload.slice(offset as number, (offset as number) + (length as number));
  }
  if (Object.keys(images).length === 0) return null;
  return { motion: motion as ReactiveAvatarMotion, images };
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
