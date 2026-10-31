/**
 * ChannelIcon — picks the right glyph from lucide-react-native based on
 * channel.type. Keep this as the single source of truth for channel iconography.
 */

import {
  Hash,
  Image as ImageIcon,
  Volume2,
  Megaphone,
  MessagesSquare,
  Film,
  ShieldCheck,
} from 'lucide-react-native';
import { useTheme } from '@/theme';
import type { ChannelType } from '@/types';

export interface ChannelIconProps {
  type: ChannelType;
  size?: number;
  color?: string;
}

export function ChannelIcon({ type, size = 16, color }: ChannelIconProps) {
  const theme = useTheme();
  const c = color ?? theme.colors.text2;
  switch (type) {
    case 'media':
      return <ImageIcon size={size} color={c} />;
    case 'voice':
      return <Volume2 size={size} color={c} />;
    case 'announcement':
      return <Megaphone size={size} color={c} />;
    case 'forum':
      return <MessagesSquare size={size} color={c} />;
    case 'theater':
      return <Film size={size} color={c} />;
    case 'rules':
      return <ShieldCheck size={size} color={c} />;
    case 'basic':
    default:
      return <Hash size={size} color={c} />;
  }
}
