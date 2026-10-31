import { useAuthStore } from '@/stores/authStore';
import { useServerStore } from '@/stores/serverStore';
import * as FileSystem from 'expo-file-system/legacy';

export interface UploadedAttachment {
  url: string;
  mime: string;
  size: number;
  thumbnailUrl?: string | null;
  /** Original file name, returned for downloads such as archives. */
  name?: string;
}

export async function uploadChatFile(
  fileUri: string,
  mime: string,
  _name: string,
  channelId?: string,
  serverUrl?: string | null,
): Promise<UploadedAttachment> {
  const auth = useAuthStore.getState();
  const servers = useServerStore.getState();
  const activeServer = servers.activeServerId ? servers.byId(servers.activeServerId) : undefined;
  const base = (serverUrl ?? activeServer?.url ?? auth.serverUrl ?? '').replace(/\/+$/, '');
  if (!base) throw new Error('Realm unavailable');
  const targetServer = servers.servers.find((server) => server.url.replace(/\/+$/, '') === base);
  const authToken = auth.user?.accountType === 'central'
    ? targetServer?.token
    : auth.token;
  if (!authToken) throw new Error('Realm session unavailable');

  const res = await FileSystem.uploadAsync(`${base}/api/uploads/chat`, fileUri, {
    uploadType: FileSystem.FileSystemUploadType.MULTIPART,
    httpMethod: 'POST',
    fieldName: 'file',
    mimeType: mime,
    parameters: channelId ? { channelId } : undefined,
    headers: {
      Authorization: `Bearer ${authToken}`,
      'X-CatRealm-Client': 'mobile',
    },
  });

  if (res.status < 200 || res.status >= 300) {
    let message = `Upload failed (${res.status})`;
    try {
      const error = JSON.parse(res.body || '{}') as { error?: string };
      if (error.error) message = error.error;
    } catch { /* The server may return plain text for rejected files. */ }
    throw new Error(message);
  }

  return JSON.parse(res.body) as UploadedAttachment;
}
