import { AES } from '@stablelib/aes';
import { GCM } from '@stablelib/gcm';
import { hmac } from '@stablelib/hmac';
import { SHA256 } from '@stablelib/sha256';
import { x25519 } from '@noble/curves/ed25519.js';
import { getRandomBytes } from 'expo-crypto';
import { getLocalDeviceId, getLocalNotificationPrivateKey } from '@/lib/deviceIdentity';

const B='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const L:Record<string,number>=Object.fromEntries(B.split('').map((c,i)=>[c,i]));
function b64(bytes:Uint8Array){let o='',i=0;for(;i+2<bytes.length;i+=3){const c=(bytes[i]<<16)|(bytes[i+1]<<8)|bytes[i+2];o+=B[(c>>18)&63]+B[(c>>12)&63]+B[(c>>6)&63]+B[c&63];}if(i<bytes.length){const r=bytes.length-i,c=(bytes[i]<<16)|(r===2?bytes[i+1]<<8:0);o+=B[(c>>18)&63]+B[(c>>12)&63]+(r===2?B[(c>>6)&63]:'=')+'=';}return o;}
function unb64(v:string){const c=v.replace(/\s+/g,''),p=c.endsWith('==')?2:c.endsWith('=')?1:0,out=new Uint8Array((c.length/4)*3-p);let o=0;for(let i=0;i<c.length;i+=4){const n=(L[c[i]]<<18)|(L[c[i+1]]<<12)|((c[i+2]==='='?0:L[c[i+2]])<<6)|(c[i+3]==='='?0:L[c[i+3]]);if(o<out.length)out[o++]=(n>>16)&255;if(o<out.length)out[o++]=(n>>8)&255;if(o<out.length)out[o++]=n&255;}return out;}
const utf8=(s:string)=>new TextEncoder().encode(s);
const cat=(...ps:Uint8Array[])=>{const out=new Uint8Array(ps.reduce((a,p)=>a+p.length,0));let o=0;for(const p of ps){out.set(p,o);o+=p.length;}return out;};
function key(shared:Uint8Array,deviceId:string){const prk=hmac(SHA256,utf8(deviceId),shared);return hmac(SHA256,prk,cat(utf8('catrealm:notification-preview:v1'),new Uint8Array([1])));}
export type NotificationPreviewTarget={id:string;notificationPublicKey:string|null};
export async function encryptNotificationPreviewForDevice(device:NotificationPreviewTarget,payload:unknown){if(!device.notificationPublicKey)return null;const eph=getRandomBytes(32),epk=x25519.getPublicKey(eph),shared=x25519.getSharedSecret(eph,unb64(device.notificationPublicKey));const aes=new AES(key(shared,device.id)),gcm=new GCM(aes),iv=getRandomBytes(12),sealed=gcm.seal(iv,utf8(JSON.stringify(payload)));gcm.clean();aes.clean();return {deviceId:device.id,encryptedPayload:JSON.stringify({v:1,epk:b64(epk),iv:b64(iv),ciphertext:b64(sealed)})};}

export type DecryptedNotificationPreview = {
  type: 'dm_message';
  conversationId: string;
  senderId?: string;
  senderDisplayName?: string;
  preview?: string;
  createdAt?: number;
};

export async function decryptNotificationPreviewEnvelope(envelope: string): Promise<DecryptedNotificationPreview | null> {
  try {
    const parsed = JSON.parse(envelope) as { v?: number; epk?: string; iv?: string; ciphertext?: string };
    if (parsed.v !== 1 || !parsed.epk || !parsed.iv || !parsed.ciphertext) return null;
    const [deviceId, privateKey] = await Promise.all([getLocalDeviceId(), getLocalNotificationPrivateKey()]);
    const shared = x25519.getSharedSecret(privateKey, unb64(parsed.epk));
    const aes = new AES(key(shared, deviceId));
    const gcm = new GCM(aes);
    const opened = gcm.open(unb64(parsed.iv), unb64(parsed.ciphertext));
    gcm.clean();
    aes.clean();
    if (!opened) return null;
    const payload = JSON.parse(new TextDecoder().decode(opened)) as DecryptedNotificationPreview;
    return payload?.type === 'dm_message' && typeof payload.conversationId === 'string' ? payload : null;
  } catch {
    return null;
  }
}
