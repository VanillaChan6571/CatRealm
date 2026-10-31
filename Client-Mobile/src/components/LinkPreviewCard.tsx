import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { useTheme } from '@/theme';
import { useUIStore } from '@/stores/uiStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { getTwitchChannelFromUrl, type LinkPreview } from '@/lib/linkPreview';

/** Generic unfurl card (mirrors desktop EmbedRenderers.buildPreviewCard). */
export function LinkPreviewCard({ url, preview }: { url: string; preview: LinkPreview }) {
  const theme = useTheme();
  const openMediaViewer = useUIStore((s) => s.openMediaViewer);
  const autoplay = !useSettingsStore((s) => s.disableEmbedAutoplay);
  const href = preview.url || url;
  const open = () => void Linking.openURL(href);
  const cardStyle = [styles.card, { backgroundColor: theme.colors.bgElev2, borderColor: theme.colors.lineSoft, borderLeftColor: theme.colors.accent }];

  const twitchChannel = getTwitchChannelFromUrl(url);
  if (preview.type === 'kick' || twitchChannel) {
    const name = (preview.authorName || twitchChannel || 'Streamer').trim();
    const avatar = preview.authorAvatar || (twitchChannel ? preview.image : null) || null;
    return (
      <Pressable onPress={open} style={cardStyle}>
        <Text style={[styles.site, { color: theme.colors.text3 }]}>
          {preview.siteName || (twitchChannel ? 'Twitch' : 'Kick')}
        </Text>
        <View style={styles.authorRow}>
          {avatar ? (
            <ExpoImage source={{ uri: avatar }} style={styles.streamAvatar} contentFit="cover" />
          ) : (
            <View style={[styles.streamAvatar, styles.initial, { backgroundColor: theme.colors.bgElev1 }]}>
              <Text style={{ color: theme.colors.text, fontWeight: '600' }}>{name.slice(0, 1).toUpperCase()}</Text>
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: theme.colors.text }]} numberOfLines={1}>{name}</Text>
            {preview.title ? (
              <Text style={[styles.desc, { color: theme.colors.text3 }]} numberOfLines={2}>{preview.title}</Text>
            ) : null}
          </View>
        </View>
        {preview.description ? (
          <Text style={[styles.desc, { color: theme.colors.text2 }]} numberOfLines={3}>{preview.description}</Text>
        ) : null}
      </Pressable>
    );
  }

  const isImageMedia = preview.type === 'media' && !!preview.mime?.startsWith('image/');
  const images = isImageMedia
    ? [preview.url]
    : Array.isArray(preview.images) && preview.images.length > 0
      ? preview.images.slice(0, 4)
      : preview.image ? [preview.image] : [];
  const hasMeta = !!(preview.siteName || preview.title || preview.description || preview.authorName);
  if (!hasMeta && images.length === 0) return null;

  const gallery = images.map((img) => ({ url: img, name: preview.title ?? null }));
  const viewImage = (index: number) => openMediaViewer(images[index], preview.title ?? null, gallery, index);

  return (
    <View style={cardStyle}>
      {hasMeta ? (
        <Pressable onPress={open} style={{ gap: 4 }}>
          <Text style={[styles.site, { color: theme.colors.text3 }]} numberOfLines={1}>{preview.siteName || 'Website'}</Text>
          {preview.authorName ? (
            <View style={styles.authorRow}>
              {preview.authorAvatar ? (
                <ExpoImage source={{ uri: preview.authorAvatar }} style={styles.authorAvatar} contentFit="cover" />
              ) : null}
              <Text style={[styles.author, { color: theme.colors.text }]} numberOfLines={1}>{preview.authorName}</Text>
            </View>
          ) : null}
          {preview.title ? (
            <Text style={[styles.title, { color: theme.colors.accent }]} numberOfLines={2}>{preview.title}</Text>
          ) : null}
          {preview.description ? (
            <Text style={[styles.desc, { color: theme.colors.text2 }]} numberOfLines={4}>{preview.description}</Text>
          ) : null}
        </Pressable>
      ) : null}
      {images.length === 1 ? (
        <Pressable onPress={() => viewImage(0)}>
          <ExpoImage source={{ uri: images[0] }} style={styles.image} contentFit="cover" autoplay={autoplay} />
        </Pressable>
      ) : images.length > 1 ? (
        <View style={styles.grid}>
          {images.map((img, index) => (
            <Pressable key={`${img}-${index}`} onPress={() => viewImage(index)} style={styles.gridCell}>
              <ExpoImage source={{ uri: img }} style={StyleSheet.absoluteFill} contentFit="cover" autoplay={autoplay} />
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: 3,
    borderRadius: 8,
    padding: 10,
    gap: 8,
    marginVertical: 2,
    maxWidth: 400,
    overflow: 'hidden',
  },
  site: { fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  authorRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  authorAvatar: { width: 20, height: 20, borderRadius: 10 },
  author: { fontSize: 13, fontWeight: '600', flexShrink: 1 },
  streamAvatar: { width: 44, height: 44, borderRadius: 22 },
  initial: { alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 14, fontWeight: '600' },
  desc: { fontSize: 13, lineHeight: 18 },
  image: { width: '100%', height: 200, borderRadius: 6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 2, borderRadius: 6, overflow: 'hidden' },
  gridCell: { width: '49.5%', height: 120 },
});
