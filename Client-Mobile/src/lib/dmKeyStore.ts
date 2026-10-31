import { AES } from '@stablelib/aes';
import { GCM } from '@stablelib/gcm';
import { hmac } from '@stablelib/hmac';
import { SHA256 } from '@stablelib/sha256';
import { x25519 } from '@noble/curves/ed25519.js';
import { getRandomBytes } from 'expo-crypto';
import { createAuthenticatedApi } from '@/lib/api';
import { getLocalDeviceId, getLocalDmPrivateKey, registerCurrentDevice } from '@/lib/deviceIdentity';
import { useAuthStore } from '@/stores/authStore';
import { getConversationSecret, saveConversationSecret } from '@/lib/dmSecretStorage';
import { accountDeviceIdKey, secureStorage } from '@/lib/storage';
import { utf8ToBytes } from '@/utils/dmCrypto';
import { captureAccountSession } from '@/lib/accountSession';
import { useDMKeyReverificationStore } from '@/stores/dmKeyReverificationStore';

const RECENT_DEVICE_TRUST_MS = 24 * 60 * 60 * 1000;

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_LOOKUP: Record<string, number> = Object.fromEntries(BASE64_ALPHABET.split('').map((c, i) => [c, i]));
function bytesToBase64(bytes: Uint8Array): string { let out=''; let i=0; for(;i+2<bytes.length;i+=3){const c=(bytes[i]<<16)|(bytes[i+1]<<8)|bytes[i+2]; out+=BASE64_ALPHABET[(c>>18)&63]+BASE64_ALPHABET[(c>>12)&63]+BASE64_ALPHABET[(c>>6)&63]+BASE64_ALPHABET[c&63];} if(i<bytes.length){const r=bytes.length-i; const c=(bytes[i]<<16)|(r===2?bytes[i+1]<<8:0); out+=BASE64_ALPHABET[(c>>18)&63]+BASE64_ALPHABET[(c>>12)&63]+(r===2?BASE64_ALPHABET[(c>>6)&63]:'=')+'=';} return out; }
function base64ToBytes(value:string){const clean=value.replace(/\s+/g,''); const pad=clean.endsWith('==')?2:clean.endsWith('=')?1:0; const out=new Uint8Array((clean.length/4)*3-pad); let o=0; for(let i=0;i<clean.length;i+=4){const c=(BASE64_LOOKUP[clean[i]]<<18)|(BASE64_LOOKUP[clean[i+1]]<<12)|((clean[i+2]==='='?0:BASE64_LOOKUP[clean[i+2]])<<6)|(clean[i+3]==='='?0:BASE64_LOOKUP[clean[i+3]]); if(o<out.length)out[o++]=(c>>16)&255;if(o<out.length)out[o++]=(c>>8)&255;if(o<out.length)out[o++]=c&255;} return out;}
const utf8 = utf8ToBytes;
function concat(...parts:Uint8Array[]){const out=new Uint8Array(parts.reduce((s,p)=>s+p.length,0));let o=0;for(const p of parts){out.set(p,o);o+=p.length;}return out;}
function deriveWrapKey(shared:Uint8Array, conversationId:string, keyVersion:number){const prk=hmac(SHA256, utf8(conversationId), shared); return hmac(SHA256, prk, concat(utf8(`catrealm:dm-wrap:v1:${keyVersion}`), new Uint8Array([1])));}
export type DMKeyManifest={conversationId:string;participantUserIds?:string[];activeKeyVersion:number|null;upgradedAt:number|null;messageCount:number;devices:Array<{id:string;userId:string;dmPublicKey:string|null;notificationPublicKey:string|null;pushCapable:boolean;dmTrustState:string;trustedAt?:number|null;trustedByDeviceId?:string|null;keyShareBlocked?:boolean;hasWrappedKeyVersions:number[]}>};
export type DMKeyRecoveryRequest={id:string;conversationId:string;keyVersion:number;requesterUserId:string;requesterDeviceId:string;approverUserId:string;status:'pending'|'reviewing'|'approved'|'completed'|'denied'|'cancelled';mode?:'key-copy'|'survivor-trust';survivorProofReady?:boolean;requestedAt:number;reviewUntil:number|null;expiresAt:number};
export function canRequestPeerKeyRecovery(manifest:DMKeyManifest,userId:string,deviceId:string):boolean{if(manifest.activeKeyVersion==null)return false; const version=manifest.activeKeyVersion; return manifest.devices.some(d=>d.id===deviceId&&d.userId===userId&&d.dmTrustState==='trusted'&&Boolean(d.dmPublicKey)&&!d.hasWrappedKeyVersions.includes(version))&&manifest.devices.some(d=>d.userId!==userId&&d.dmTrustState==='trusted'&&d.hasWrappedKeyVersions.includes(version));}
// True when every device holding the active key is a hardened device whose
// passkey proof has lapsed — the conversation can't unlock until one of them
// is re-trusted (or re-proves), no matter how long we wait.
export function areAllKeyHoldersBlocked(manifest:DMKeyManifest):boolean{if(manifest.activeKeyVersion==null)return false; const holders=manifest.devices.filter((d)=>d.hasWrappedKeyVersions.includes(manifest.activeKeyVersion!)); return holders.length>0&&holders.every((d)=>d.keyShareBlocked===true);}
// Encryption state of a conversation from THIS device's point of view:
// - 'pending': still on v1 — no active key yet (e.g. the other participant has
//   not set up a key-bearing device, so v2 can't activate).
// - 'synced': v2 is active and this device holds a wrapped key for it.
// - 'locked': v2 is active but this device has no key for it (needs approval /
//   a backfill from another trusted device).
export type DMEncryptionState='pending'|'synced'|'locked';
export function deriveDMEncryptionState(manifest:DMKeyManifest,deviceId:string):DMEncryptionState{if(manifest.activeKeyVersion==null)return 'pending'; const device=manifest.devices.find((entry)=>entry.id===deviceId); if(device&&device.hasWrappedKeyVersions.includes(manifest.activeKeyVersion))return 'synced'; return 'locked';}
async function save(conversationId:string,keyVersion:number,secret:string,userId:string,deviceId:string){if(useAuthStore.getState().user?.id!==userId)throw new Error('Account changed'); await saveConversationSecret(userId,deviceId,conversationId,keyVersion,secret);}
export async function getLocalConversationSecret(conversationId:string,keyVersion:number){const userId=useAuthStore.getState().user?.id; if(!userId)return null; const deviceId=await secureStorage.get(accountDeviceIdKey(userId))??await getLocalDeviceId(); const secret=await getConversationSecret(userId,deviceId,conversationId,keyVersion); return useAuthStore.getState().user?.id===userId?secret:null;}
export async function createSurvivorTrustProof(request:DMKeyRecoveryRequest):Promise<string>{
  const userId=useAuthStore.getState().user?.id;
  if(!userId||![request.requesterUserId,request.approverUserId].includes(userId))throw new Error('Account changed during device verification.');
  const secret=await getLocalConversationSecret(request.conversationId,request.keyVersion)
    ??(userId===request.approverUserId?await loadConversationSecretForCurrentDevice(request.conversationId,request.keyVersion):null);
  if(!secret)throw new Error('This device cannot read the DM key needed to verify the other device.');
  const key=base64ToBytes(secret);
  if(key.length!==32)throw new Error('This device has an invalid local DM key.');
  const message=utf8(`catrealm:dm-survivor-trust:v1:${request.id}:${request.conversationId}:${request.keyVersion}:${request.requesterUserId}:${request.requesterDeviceId}`);
  return bytesToBase64(hmac(SHA256,key,message));
}
async function wrapSecret(secret:string,pub:string,conversationId:string,keyVersion:number){const eph=getRandomBytes(32); const epk=x25519.getPublicKey(eph); const shared=x25519.getSharedSecret(eph,base64ToBytes(pub)); const cipher=new AES(deriveWrapKey(shared,conversationId,keyVersion)); const gcm=new GCM(cipher); const iv=getRandomBytes(12); const sealed=gcm.seal(iv,base64ToBytes(secret)); gcm.clean(); cipher.clean(); return JSON.stringify({v:1,epk:bytesToBase64(epk),iv:bytesToBase64(iv),ciphertext:bytesToBase64(sealed)});}
async function unwrapSecret(wrapped:string,conversationId:string,keyVersion:number){const p=JSON.parse(wrapped) as {v:number;epk:string;iv:string;ciphertext:string}; const shared=x25519.getSharedSecret(await getLocalDmPrivateKey(),base64ToBytes(p.epk)); const cipher=new AES(deriveWrapKey(shared,conversationId,keyVersion)); const gcm=new GCM(cipher); const opened=gcm.open(base64ToBytes(p.iv),base64ToBytes(p.ciphertext)); gcm.clean(); cipher.clean(); if(!opened) throw new Error('Failed to unwrap DM key'); return bytesToBase64(opened);}
export async function fetchDMKeyManifest(conversationId:string){return (await createAuthenticatedApi().get<DMKeyManifest>(`/api/dms/conversations/${conversationId}/key-manifest`)).data;}
const lastBackgroundSyncAt = new Map<string, number>();
const BACKGROUND_SYNC_GAP_MS = 30_000;
export function scheduleTrustedDeviceKeySync(conversationId:string,keyVersion:number,secret:string){const userId=useAuthStore.getState().user?.id; if(!userId)return; const key=`${userId}:${conversationId}:${keyVersion}`; const now=Date.now(); if(now-(lastBackgroundSyncAt.get(key)??0)<BACKGROUND_SYNC_GAP_MS)return; lastBackgroundSyncAt.set(key,now); void syncTrustedDeviceKeysForConversation(conversationId,keyVersion,secret).catch(()=>{});}
export async function ensureNewConversationSecret(conversationId:string){const userId=useAuthStore.getState().user?.id; if(!userId)throw new Error('No active account for DM key'); const deviceId=await registerCurrentDevice(); const m=await fetchDMKeyManifest(conversationId); if(m.activeKeyVersion!=null)return null; const targets=m.devices.filter(d=>d.dmTrustState==='trusted'&&d.dmPublicKey); if(!targets.length)return null; const participantUserIds=m.participantUserIds??[...new Set(m.devices.map(d=>d.userId))]; const readyUsers=new Set(targets.map(d=>d.userId)); if(!participantUserIds.every(u=>readyUsers.has(u)))return null; const secret=bytesToBase64(getRandomBytes(32)); const keyVersion=1; const wrappedKeys=await Promise.all(targets.map(async d=>({deviceId:d.id,wrappedConversationSecret:await wrapSecret(secret,d.dmPublicKey!,conversationId,keyVersion)}))); try{await createAuthenticatedApi().post(`/api/dms/conversations/${conversationId}/keys`,{sourceDeviceId:deviceId,keyVersion,wrappedKeys});}catch(err){const r=(err as {response?:{status?:number;data?:{code?:string}}})?.response; if(r?.status===409&&r?.data?.code==='DM_V2_PARTICIPANT_UNREADY')return null; throw err;} await save(conversationId,keyVersion,secret,userId,deviceId); return {secret,keyVersion};}
export async function loadConversationSecretForCurrentDevice(conversationId:string,keyVersion:number,forceRefresh=false){const userId=useAuthStore.getState().user?.id; if(!userId)throw new Error('No active account for DM key'); const existing=forceRefresh?null:await getLocalConversationSecret(conversationId,keyVersion); if(existing){scheduleTrustedDeviceKeySync(conversationId,keyVersion,existing); return existing;} const deviceId=await registerCurrentDevice(); if(useAuthStore.getState().user?.id!==userId)throw new Error('Account changed'); const res=await createAuthenticatedApi().get<{keys:Array<{keyVersion:number;wrappedConversationSecret:string}>}>(`/api/dms/conversations/${conversationId}/keys/me`,{params:{deviceId}}); if(useAuthStore.getState().user?.id!==userId)throw new Error('Account changed'); const wrapped=res.data.keys.find(k=>k.keyVersion===keyVersion); if(!wrapped)return null; const secret=await unwrapSecret(wrapped.wrappedConversationSecret,conversationId,keyVersion); await save(conversationId,keyVersion,secret,userId,deviceId); scheduleTrustedDeviceKeySync(conversationId,keyVersion,secret); return secret;}
export async function retryCurrentDeviceDMKey(conversationId:string){const manifest=await fetchDMKeyManifest(conversationId); if(manifest.activeKeyVersion==null)return null; const deviceId=await getLocalDeviceId(); if(!manifest.devices.some(d=>d.id===deviceId&&d.hasWrappedKeyVersions.includes(manifest.activeKeyVersion!)))return null; return loadConversationSecretForCurrentDevice(conversationId,manifest.activeKeyVersion,true);}

async function backfillMissingTrustedDeviceKeys(manifest:DMKeyManifest,secret:string){
  if(manifest.activeKeyVersion==null)return;
  const session=captureAccountSession();
  const userId=session.user?.id;
  if(!userId||session.user?.accountType!=='central')return;
  useDMKeyReverificationStore.getState().setAccountId(userId);
  const sourceDeviceId=await getLocalDeviceId();
  if(!session.isCurrent())return;
  const sourceDevice=manifest.devices.find(d=>d.id===sourceDeviceId&&d.userId===userId);
  if(!sourceDevice)return;
  const missing=manifest.devices.filter(d=>d.dmTrustState==='trusted'&&d.dmPublicKey&&!d.hasWrappedKeyVersions.includes(manifest.activeKeyVersion!)&&d.userId===userId);
  if(!missing.length)return;
  const recentlySelfApproved=missing.find(d=>d.userId===userId&&d.id!==sourceDeviceId&&d.trustedByDeviceId===d.id&&typeof d.trustedAt==='number'&&Date.now()-d.trustedAt*1000>=0&&Date.now()-d.trustedAt*1000<=RECENT_DEVICE_TRUST_MS);
  if(recentlySelfApproved)useDMKeyReverificationStore.getState().notePasskeyApprovedDevice(userId,recentlySelfApproved.id);
  const wrappedKeys=await Promise.all(missing.map(async d=>({deviceId:d.id,wrappedConversationSecret:await wrapSecret(secret,d.dmPublicKey!,manifest.conversationId,manifest.activeKeyVersion!)})));
  if(!session.isCurrent())return;
  const targetIds=missing.map(d=>d.id);
  try{
    await createAuthenticatedApi().post(`/api/dms/conversations/${manifest.conversationId}/keys`,{sourceDeviceId,keyVersion:manifest.activeKeyVersion,wrappedKeys});
    if(session.isCurrent())useDMKeyReverificationStore.getState().clearForTargets(userId,targetIds);
  }catch(error){
    const proofRequired=Boolean((error as {response?:{data?:{proofRequired?:boolean}}})?.response?.data?.proofRequired);
    if(proofRequired&&session.isCurrent())useDMKeyReverificationStore.getState().markProofRequired(userId,targetIds);
    throw error;
  }
}
export async function syncTrustedDeviceKeysForConversation(conversationId:string,keyVersion:number,secret:string){const manifest=await fetchDMKeyManifest(conversationId); if(manifest.activeKeyVersion!==keyVersion)return; await backfillMissingTrustedDeviceKeys(manifest,secret);}
export async function shareDMKeyForRecovery(request:DMKeyRecoveryRequest){
  const session=captureAccountSession();
  const manifest=await fetchDMKeyManifest(request.conversationId);
  if(!session.isCurrent())throw new Error('Account changed.');
  if(manifest.activeKeyVersion!==request.keyVersion)throw new Error('The DM key changed. Ask for recovery again.');
  const sourceDeviceId=await getLocalDeviceId();
  const source=manifest.devices.find(d=>d.id===sourceDeviceId&&d.userId===request.approverUserId&&d.hasWrappedKeyVersions.includes(request.keyVersion));
  const target=manifest.devices.find(d=>d.id===request.requesterDeviceId&&d.userId===request.requesterUserId&&d.dmTrustState==='trusted'&&d.dmPublicKey);
  if(!source||!target)throw new Error('This device cannot share the requested DM key.');
  const secret=await loadConversationSecretForCurrentDevice(request.conversationId,request.keyVersion);
  if(!secret)throw new Error('This device does not have the DM key.');
  const wrappedConversationSecret=await wrapSecret(secret,target.dmPublicKey!,request.conversationId,request.keyVersion);
  if(!session.isCurrent())throw new Error('Account changed.');
  await createAuthenticatedApi().post(`/api/dms/conversations/${request.conversationId}/keys`,{sourceDeviceId,keyVersion:request.keyVersion,recoveryRequestId:request.id,wrappedKeys:[{deviceId:target.id,wrappedConversationSecret}]});
}
export async function syncKnownConversationKeys(){
  const session=captureAccountSession();
  if(!session.user||session.user.accountType!=='central')return;
  const {useDMStore}=await import('@/stores/dmStore');
  if(!session.isCurrent())return;
  if(!useDMStore.getState().conversations.length)await useDMStore.getState().fetchConversations();
  for(const conversation of useDMStore.getState().conversations){
    if(!session.isCurrent())return;
    try{
      const manifest=await fetchDMKeyManifest(conversation.id);
      if(manifest.activeKeyVersion==null)continue;
      const secret=await getLocalConversationSecret(conversation.id,manifest.activeKeyVersion);
      if(secret)await backfillMissingTrustedDeviceKeys(manifest,secret);
    }catch{
      // Continue syncing the other conversations; a later pass can retry this one.
    }
  }
}
export async function getConversationSecretForSend(conversationId:string){await registerCurrentDevice(); const manifest=await fetchDMKeyManifest(conversationId); if(manifest.activeKeyVersion!=null){const secret=await loadConversationSecretForCurrentDevice(conversationId,manifest.activeKeyVersion); if(!secret) throw new Error('No v2 DM key available for this device');
  // Best-effort, like desktop: distributing keys to OTHER devices can 403 when
  // this device needs a fresh passkey/platform proof — that must never block
  // sending, since the sender already holds the secret.
  await backfillMissingTrustedDeviceKeys(manifest,secret).catch(()=>{});
  return {secret,keyVersion:manifest.activeKeyVersion};} return ensureNewConversationSecret(conversationId);}
