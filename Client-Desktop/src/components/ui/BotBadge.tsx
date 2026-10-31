import { Bot } from 'lucide-react';

interface BotBadgeProps {
  isBot?: boolean | number;
  size?: 'sm' | 'md';
  className?: string;
}

export function BotBadge({ isBot, size = 'sm', className = '' }: BotBadgeProps) {
  if (!isBot) return null;

  const sizeClass = size === 'sm'
    ? 'text-[10px] px-1 py-px gap-0.5'
    : 'text-xs px-1.5 py-0.5 gap-1';
  const iconClass = size === 'sm' ? 'w-2.5 h-2.5' : 'w-3 h-3';

  return (
    <span
      className={`inline-flex items-center rounded font-bold uppercase tracking-wide bg-indigo-600 text-white ${sizeClass} ${className}`}
      title="Bot account"
    >
      <Bot className={iconClass} />
      BOT
    </span>
  );
}
