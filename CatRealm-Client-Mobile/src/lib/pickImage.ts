/**
 * pickImage — ask where a single image comes from (Photo Library or Files),
 * then open that picker. Used for avatar and banner uploads.
 */

import { ActionSheetIOS, Alert, Platform } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import i18n from '@/i18n';

export interface PickedImage { uri: string; mimeType: string; name: string }

type Source = 'library' | 'files';

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const EXTENSIONS: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

function chooseSource(): Promise<Source | null> {
  const t = i18n.t.bind(i18n);
  const library = t('media.photoLibrary');
  const files = t('media.files');
  const cancel = t('common.cancel');
  if (Platform.OS === 'web') return Promise.resolve('files');
  return new Promise((resolve) => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: [library, files, cancel], cancelButtonIndex: 2 },
        (index) => resolve(index === 0 ? 'library' : index === 1 ? 'files' : null),
      );
      return;
    }
    Alert.alert(t('media.chooseImage'), undefined, [
      { text: cancel, style: 'cancel', onPress: () => resolve(null) },
      { text: files, onPress: () => resolve('files') },
      { text: library, onPress: () => resolve('library') },
    ], { cancelable: true, onDismiss: () => resolve(null) });
  });
}

// A second tap while a chooser or picker is opening would stack another one.
let picking = false;

/** Returns null when the user cancels at either step, or while another pick is open. */
export async function pickImage(fallbackName: string): Promise<PickedImage | null> {
  if (picking) return null;
  picking = true;
  try {
    return await pickImageOnce(fallbackName);
  } finally {
    picking = false;
  }
}

async function pickImageOnce(fallbackName: string): Promise<PickedImage | null> {
  const source = await chooseSource();
  if (!source) return null;

  if (source === 'files') {
    const picked = await DocumentPicker.getDocumentAsync({ type: IMAGE_TYPES, copyToCacheDirectory: true });
    const asset = picked.canceled ? null : picked.assets?.[0];
    if (!asset) return null;
    const mimeType = asset.mimeType ?? 'image/jpeg';
    return { uri: asset.uri, mimeType, name: asset.name ?? `${fallbackName}.${EXTENSIONS[mimeType] ?? 'jpg'}` };
  }

  const picked = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 1,
    allowsEditing: false,
    // HEIC photos come back as JPEG, which the profile endpoints accept.
    preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
  });
  const asset = picked.canceled ? null : picked.assets?.[0];
  if (!asset) return null;
  const mimeType = asset.mimeType && IMAGE_TYPES.includes(asset.mimeType) ? asset.mimeType : 'image/jpeg';
  const extension = EXTENSIONS[mimeType] ?? 'jpg';
  const baseName = asset.fileName?.replace(/\.[^.]+$/, '') || fallbackName;
  return { uri: asset.uri, mimeType, name: `${baseName}.${extension}` };
}
