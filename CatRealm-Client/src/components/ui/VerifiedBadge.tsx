interface VerifiedBadgeProps {
  verified?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}

export function VerifiedBadge({ verified, size = 'sm', className = '' }: VerifiedBadgeProps) {
  if (!verified) return null;

  const sizeClass = size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4';

  return (
    <span
      className={`inline-block ${sizeClass} ${className}`}
      title="Verified Central Account"
    >
      <svg viewBox="0 0 16 16" fill="currentColor" className="text-blue-500">
        <path d="M8 0L9.7 5.5L16 5.5L11.1 9.2L13.2 15L8 11L2.8 15L4.9 9.2L0 5.5L6.3 5.5L8 0Z" />
        <path d="M6 8L7 9L10 6" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}
