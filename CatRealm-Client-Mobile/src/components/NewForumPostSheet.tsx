import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { ImagePlus, Paperclip, X } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme';
import { Text } from './Text';
import { Pressable } from './Pressable';
import { Sheet } from './Sheet';
import { createApi } from '@/lib/api';
import { uploadChatFile } from '@/lib/uploadApi';

interface PickedImage { uri: string; mime: string; name: string }

interface Props {
  open: boolean;
  channelId: string;
  serverUrl?: string | null;
  onClose: () => void;
  onCreated: (postId: string, title: string) => void;
}

async function pickImages(multiple: boolean): Promise<PickedImage[]> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 1,
    allowsMultipleSelection: multiple,
    preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
  });
  if (result.canceled) return [];
  return result.assets.map((asset, i) => ({
    uri: asset.uri,
    mime: asset.mimeType ?? 'image/jpeg',
    name: asset.fileName ?? `photo-${i + 1}.jpg`,
  }));
}

export function NewForumPostSheet({ open, channelId, serverUrl, onClose, onCreated }: Props) {
  const theme = useTheme();
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [cover, setCover] = useState<PickedImage | null>(null);
  const [images, setImages] = useState<PickedImage[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) return;
    setTitle('');
    setBody('');
    setCover(null);
    setImages([]);
  }, [open]);

  const canSubmit = title.trim().length > 0 && body.trim().length > 0 && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const upload = (img: PickedImage) => uploadChatFile(img.uri, img.mime, img.name, channelId, serverUrl);
      const [coverUpload, attachments] = await Promise.all([cover ? upload(cover) : null, Promise.all(images.map(upload))]);
      const api = createApi();
      // Same two-step flow as desktop: the body is a channel message, the post is a thread on it.
      const msg = await api.post<{ id: string }>('/api/messages/forum', {
        channelId,
        content: body.trim(),
        attachments: attachments.map((a) => ({ url: a.url, mime: a.mime, size: a.size })),
      });
      const thread = await api.post<{ id: string; name: string }>('/api/threads', {
        channelId,
        messageId: msg.data.id,
        name: title.trim(),
        coverImage: coverUpload?.url ?? null,
      });
      onCreated(thread.data.id, thread.data.name);
    } catch (error) {
      const serverError = (error as { response?: { data?: { error?: string } } }).response?.data?.error;
      Alert.alert(t('forum.createFailed'), serverError ?? (error instanceof Error ? error.message : undefined));
    } finally {
      setSubmitting(false);
    }
  };

  const inputStyle = [styles.input, { color: theme.colors.text, backgroundColor: theme.colors.bgElev1, borderRadius: theme.radius.md }];

  return (
    <Sheet open={open} onClose={submitting ? () => {} : onClose} maxHeightFraction={0.9} avoidKeyboard>
      <View style={styles.header}>
        <Text variant="title" style={{ flex: 1 }}>{t('forum.newPost')}</Text>
        <Pressable haptic onPress={() => void handleSubmit()} disabled={!canSubmit}
          style={[styles.postBtn, { backgroundColor: theme.colors.accent, opacity: canSubmit ? 1 : 0.5 }]}>
          {submitting
            ? <ActivityIndicator size="small" color={theme.colors.textOnAccent} />
            : <Text variant="subtitle" color={theme.colors.textOnAccent}>{t('forum.post')}</Text>}
        </Pressable>
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder={t('forum.titlePlaceholder')}
          placeholderTextColor={theme.colors.text3}
          maxLength={100}
          style={[inputStyle, { fontWeight: '600' }]}
          editable={!submitting}
        />
        <TextInput
          value={body}
          onChangeText={setBody}
          placeholder={t('forum.bodyPlaceholder')}
          placeholderTextColor={theme.colors.text3}
          maxLength={2000}
          multiline
          textAlignVertical="top"
          style={[inputStyle, styles.bodyInput]}
          editable={!submitting}
        />

        {cover ? (
          <View>
            <Image source={{ uri: cover.uri }} style={[styles.cover, { borderRadius: theme.radius.md }]} resizeMode="cover" />
            <Pressable onPress={() => setCover(null)} style={styles.removeBtn} accessibilityLabel={t('forum.removeCover')}>
              <X size={14} color="#fff" />
            </Pressable>
          </View>
        ) : null}

        {images.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {images.map((img, i) => (
              <View key={`${img.uri}-${i}`}>
                <Image source={{ uri: img.uri }} style={[styles.thumb, { borderRadius: theme.radius.md }]} />
                <Pressable onPress={() => setImages((prev) => prev.filter((_, idx) => idx !== i))} style={styles.removeBtn}>
                  <X size={12} color="#fff" />
                </Pressable>
              </View>
            ))}
          </ScrollView>
        ) : null}

        <View style={styles.actions}>
          {!cover ? (
            <Pressable haptic disabled={submitting} onPress={() => void pickImages(false).then(([img]) => img && setCover(img))}
              style={[styles.action, { borderColor: theme.colors.lineSoft }]}>
              <ImagePlus size={16} color={theme.colors.text2} />
              <Text variant="bodySmall" color={theme.colors.text2}>{t('forum.addCover')}</Text>
            </Pressable>
          ) : null}
          <Pressable haptic disabled={submitting} onPress={() => void pickImages(true).then((picked) => setImages((prev) => [...prev, ...picked]))}
            style={[styles.action, { borderColor: theme.colors.lineSoft }]}>
            <Paperclip size={16} color={theme.colors.text2} />
            <Text variant="bodySmall" color={theme.colors.text2}>{t('forum.addImages')}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 8, gap: 8 },
  postBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999, minWidth: 64, alignItems: 'center' },
  content: { paddingHorizontal: 16, paddingBottom: 24, gap: 10 },
  input: { paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  bodyInput: { minHeight: 120, maxHeight: 240 },
  cover: { width: '100%', height: 140 },
  thumb: { width: 72, height: 72 },
  removeBtn: { position: 'absolute', top: 4, right: 4, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 999, padding: 3 },
  actions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  action: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth },
});
