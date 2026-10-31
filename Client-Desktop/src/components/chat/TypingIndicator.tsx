import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { usePresenceStore } from '../../stores/presenceStore';
import { useChannelStore } from '../../stores/channelStore';
import { useAuthStore } from '../../stores/authStore';
import { useMotionProfile } from '../../lib/motion';
import { resolveAvatarUrl } from '../../utils/avatar';
import type { OnlineUser } from '../../types';

const EMPTY_TYPING: string[] = [];
const MAX_AVATARS = 3;
const ROTATE_MS = 2500;

function AvatarFace({ username, member, serverUrl }: { username: string; member?: OnlineUser; serverUrl: string | null }) {
  const avatar = resolveAvatarUrl(member?.avatar, serverUrl, member?.accountType);
  return avatar
    ? <img src={avatar} alt="" className="h-full w-full object-cover" />
    : <>{Array.from(member?.displayName || username)[0]?.toUpperCase()}</>;
}

/** Last slot when more people are typing than fit: slowly crossfades through the hidden typers' faces under a +N count. */
function RotatingAvatar({ usernames, membersByName, serverUrl }: {
  usernames: string[];
  membersByName: Map<string, OnlineUser>;
  serverUrl: string | null;
}) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (usernames.length < 2) return;
    const id = window.setInterval(() => setTick((t) => t + 1), ROTATE_MS);
    return () => window.clearInterval(id);
  }, [usernames.length]);
  const current = usernames[tick % usernames.length];
  return (
    <>
      <AnimatePresence initial={false}>
        <motion.span
          key={current}
          className="absolute inset-0 flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.8, ease: 'easeInOut' }}
        >
          <AvatarFace username={current} member={membersByName.get(current)} serverUrl={serverUrl} />
        </motion.span>
      </AnimatePresence>
      <span className="typing-avatar-count">+{usernames.length}</span>
    </>
  );
}

export function TypingIndicator() {
  const activeChannelId = useChannelStore((s) => s.activeChannelId);
  const allTyping = usePresenceStore((s) => s.typingUsers);
  const allMembers = usePresenceStore((s) => s.allMembers);
  const typingUsers = (activeChannelId ? allTyping[activeChannelId] : undefined) ?? EMPTY_TYPING;
  const currentUsername = useAuthStore((s) => s.user?.username);
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const motionProfile = useMotionProfile();

  // Typing events carry usernames only; avatars come from the member list.
  const membersByName = useMemo(() => new Map(allMembers.map((m) => [m.username, m])), [allMembers]);

  // Filter out current user
  const others = typingUsers.filter((u) => u !== currentUsername);

  let text = '';
  if (others.length === 1) {
    text = `${others[0]} is typing`;
  } else if (others.length === 2) {
    text = `${others[0]} and ${others[1]} are typing`;
  } else if (others.length > 2) {
    text = 'Several people are typing';
  }

  const shown = others.slice(0, MAX_AVATARS);
  const hidden = others.slice(MAX_AVATARS);

  // Reserve the row height at all times so messages don't jump when typing
  // starts/stops; fade the content itself in and out.
  return (
    <div className="h-6 px-4 flex items-center">
      <AnimatePresence>
        {others.length > 0 && (
          <motion.div
            key="typing"
            className="flex items-center gap-2 min-w-0"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 2 }}
            transition={motionProfile.fade}
          >
            <div className="flex shrink-0 gap-0.5">
              {/* Each newcomer bounces up from below; the stack slides to make room. */}
              <AnimatePresence initial={false} mode="popLayout">
                {shown.map((username) => {
                  const member = membersByName.get(username);
                  return (
                    <motion.span
                      key={username}
                      layout
                      className="typing-avatar"
                      initial={{ opacity: 0, y: 10, scale: 0.6 }}
                      animate={{ opacity: 1, y: 0, scale: 1, transition: motionProfile.pop }}
                      exit={{ opacity: 0, y: 6, scale: 0.7, transition: motionProfile.exit }}
                      title={member?.displayName || username}
                    >
                      <AvatarFace username={username} member={member} serverUrl={serverUrl} />
                    </motion.span>
                  );
                })}
                {hidden.length > 0 && (
                  <motion.span
                    key="overflow"
                    layout
                    className="typing-avatar relative"
                    initial={{ opacity: 0, y: 10, scale: 0.6 }}
                    animate={{ opacity: 1, y: 0, scale: 1, transition: motionProfile.pop }}
                    exit={{ opacity: 0, scale: 0.7, transition: motionProfile.exit }}
                    title={hidden.map((u) => membersByName.get(u)?.displayName || u).join(', ')}
                  >
                    <RotatingAvatar usernames={hidden} membersByName={membersByName} serverUrl={serverUrl} />
                  </motion.span>
                )}
              </AnimatePresence>
            </div>
            <span className="text-xs truncate">
              <span className="typing-shimmer">{text}</span>
              <span className="typing-dots text-text-muted" aria-hidden="true"><span>.</span><span>.</span><span>.</span></span>
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
