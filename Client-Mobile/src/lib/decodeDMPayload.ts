import { decryptDM, decryptDMV2, getDMPayloadVersion } from '@/utils/dmCrypto';
import { loadConversationSecretForCurrentDevice } from '@/lib/dmKeyStore';

/** A history page needs each conversation key at most once, even when none is available. */
export function createDMKeyBatchLoader(
  loadSecret: (conversationId: string, keyVersion: number) => Promise<string | null> = loadConversationSecretForCurrentDevice,
) {
  const lookups = new Map<string, Promise<string | null>>();
  return (conversationId: string, keyVersion: number): Promise<string | null> => {
    const key = `${conversationId}:${keyVersion}`;
    let lookup = lookups.get(key);
    if (!lookup) {
      lookup = loadSecret(conversationId, keyVersion);
      lookups.set(key, lookup);
    }
    return lookup;
  };
}

/** Current DMs use their conversation key, independently of the account sync key. */
export async function decodeDMPayload(
  payload: string,
  syncKey: string | null,
  conversationId: string,
  loadSecret: (conversationId: string, keyVersion: number) => Promise<string | null> = loadConversationSecretForCurrentDevice,
): Promise<string> {
  if (getDMPayloadVersion(payload) === 2) {
    const { kid } = JSON.parse(payload) as { kid: number };
    const secret = await loadSecret(conversationId, kid);
    if (!secret) throw new Error('No v2 DM key available for this device');
    return decryptDMV2(payload, secret, conversationId);
  }
  if (!syncKey) throw new Error('No sync key available');
  return decryptDM(payload, syncKey, conversationId);
}
