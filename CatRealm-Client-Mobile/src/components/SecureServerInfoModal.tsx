import { Modal, ScrollView, TouchableOpacity, View } from 'react-native';
import { Lock } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme';
import { Text } from './Text';

/**
 * Explains a realm's locked secure mode (encryption at rest), opened from the
 * channel header's Encrypted badge. Mirrors the desktop "Secure Server" dialog
 * and is laid out like the DM end-to-end encryption info modal.
 */
export function SecureServerInfoModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const theme = useTheme();
  const { t } = useTranslation();

  const section = (title: string, body: string) => (
    <View style={{ gap: 4 }}>
      <Text variant="body" style={{ fontWeight: '600' }}>{title}</Text>
      <Text variant="caption" color={theme.colors.text2} style={{ lineHeight: 18 }}>
        {body}
      </Text>
    </View>
  );

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent
      supportedOrientations={['portrait', 'portrait-upside-down', 'landscape', 'landscape-left', 'landscape-right']}>
      <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center', padding: 24 }} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} onPress={() => {}} style={{ width: '100%', maxWidth: 420 }}>
          <View style={{ backgroundColor: theme.colors.bgElev1, borderRadius: theme.radius.xl, overflow: 'hidden' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 20, borderBottomWidth: 1, borderBottomColor: theme.colors.lineSoft }}>
              <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(52,211,153,0.15)', alignItems: 'center', justifyContent: 'center' }}>
                <Lock size={22} color="#34d399" />
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="subtitle" style={{ fontWeight: '700' }}>{t('secureServer.title')}</Text>
                <Text variant="caption" color={theme.colors.text3}>{t('secureServer.subtitle')}</Text>
              </View>
            </View>

            <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={{ padding: 20, gap: 16 }}>
              {section(t('secureServer.howTitle'), t('secureServer.howBody'))}
              {section(t('secureServer.lockTitle'), t('secureServer.lockBody'))}
              {section(t('chat.messageStorage'), t('secureServer.storageBody'))}
              {/* Amber like desktop: unlike DM E2EE, the server operator can still decrypt. */}
              <View style={{ backgroundColor: 'rgba(245,158,11,0.12)', borderRadius: 10, borderWidth: 1, borderColor: 'rgba(245,158,11,0.35)', padding: 12 }}>
                <Text variant="caption" style={{ color: '#fcd34d', lineHeight: 17 }}>
                  <Text variant="caption" style={{ fontWeight: '700', color: '#fcd34d' }}>{t('secureServer.noteLabel')}</Text>
                  {t('secureServer.noteBody')}
                </Text>
              </View>
            </ScrollView>

            <View style={{ padding: 16, borderTopWidth: 1, borderTopColor: theme.colors.lineSoft }}>
              <TouchableOpacity onPress={onClose} style={{ backgroundColor: theme.colors.accent, borderRadius: theme.radius.md, paddingVertical: 10, alignItems: 'center' }}>
                <Text variant="body" style={{ color: '#fff', fontWeight: '600' }}>{t('chat.gotIt')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}
