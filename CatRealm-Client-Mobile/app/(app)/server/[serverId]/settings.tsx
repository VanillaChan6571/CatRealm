import { Empty } from '@/components';
import { useTranslation } from 'react-i18next';

export default function ServerSettings() {
  const { t } = useTranslation();
  return <Empty title={t('server.settingsTitle')} subtitle={t('server.settingsSubtitle')} />;
}
