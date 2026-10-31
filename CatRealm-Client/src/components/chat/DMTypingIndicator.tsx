import { motion } from 'motion/react';
import { useMotionProfile } from '../../lib/motion';

type DMTypingIndicatorProps = {
  avatarUrl: string;
  avatarAlt: string;
  displayName: string;
};

export function DMTypingIndicator({
  avatarUrl,
  avatarAlt,
  displayName,
}: DMTypingIndicatorProps) {
  const motionProfile = useMotionProfile();
  return (
    <motion.div
      className="flex gap-4 px-6 py-2 items-center"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 4 }}
      transition={motionProfile.sheet}
    >
      <img
        src={avatarUrl}
        alt={avatarAlt}
        className="w-12 h-12 rounded-full"
      />
      <div className="flex items-center gap-2 text-text-muted italic">
        <span>{displayName} is typing</span>
        <div className="flex gap-1">
          <span className="w-2 h-2 bg-text-muted rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
          <span className="w-2 h-2 bg-text-muted rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
          <span className="w-2 h-2 bg-text-muted rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
        </div>
      </div>
    </motion.div>
  );
}
