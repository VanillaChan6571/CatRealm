/**
 * Cat Lab — encryption for reactive avatar packs shared between friends.
 *
 * The key is derived from the friends' existing DM conversation secret with its
 * own HKDF label, so it can never be confused with message encryption, and only
 * devices trusted for that DM can derive it. Every sealed message is bound (as
 * AES-GCM additional data) to its kind, sender, receiver and pack hash, so it
 * can't be replayed to someone else, reflected back, or passed off as a
 * different pack. A self-hosted server that lies about who a participant is
 * can't produce anything that decrypts under the real DM key.
 */
import { base64ToBytes } from '../../messaging/crypto/base64';

const IV_BYTES = 12;

export async function deriveAvatarShareKey(conversationSecretBase64: string, conversationId: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', base64ToBytes(conversationSecretBase64) as BufferSource, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new TextEncoder().encode(conversationId),
      info: new TextEncoder().encode('catrealm:obs-avatar:v1'),
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export type ShareMessageKind = 'offer' | 'pack';

export function shareAad(kind: ShareMessageKind, senderCentralId: string, receiverCentralId: string, packHash: string): Uint8Array {
  return new TextEncoder().encode(`catrealm:obs-avatar:v1|${kind}|${senderCentralId}|${receiverCentralId}|${packHash}`);
}

/** Returns iv || ciphertext. */
export async function sealForFriend(key: CryptoKey, plaintext: Uint8Array, aad: Uint8Array): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource, additionalData: aad as BufferSource },
    key,
    plaintext as BufferSource,
  ));
  const out = new Uint8Array(IV_BYTES + ciphertext.byteLength);
  out.set(iv, 0);
  out.set(ciphertext, IV_BYTES);
  return out;
}

/** Returns the plaintext, or null if it was tampered with, misaddressed or keyed differently. */
export async function openFromFriend(key: CryptoKey, sealed: Uint8Array, aad: Uint8Array): Promise<Uint8Array | null> {
  if (sealed.byteLength <= IV_BYTES) return null;
  try {
    return new Uint8Array(await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: sealed.subarray(0, IV_BYTES) as BufferSource, additionalData: aad as BufferSource },
      key,
      sealed.subarray(IV_BYTES) as BufferSource,
    ));
  } catch {
    return null;
  }
}
