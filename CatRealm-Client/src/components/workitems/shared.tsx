import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Search, Settings2 } from 'lucide-react';
import { AvatarImage } from '../ui/AvatarImage';
import { resolveAvatarUrl } from '../../utils/avatar';
import type { WorkItemLabel, WorkItemUser } from '../../types';
import { useRealmUrl, userLabel } from './workItemUtils';

// Building blocks shared by the Tracker and Board channel views.

export function UserAvatar({ user, size = 20 }: { user: WorkItemUser | null; size?: number }) {
  const serverUrl = useRealmUrl();
  const name = userLabel(user);
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-bg-hover text-[10px] font-semibold text-text-secondary"
      style={{ width: size, height: size }}
      title={name}
    >
      <AvatarImage
        src={resolveAvatarUrl(user?.avatar, serverUrl, user?.account_type)}
        alt={name}
        size={size}
        className="h-full w-full object-cover"
        fallback={<span>{name.charAt(0).toUpperCase()}</span>}
      />
    </span>
  );
}

export function AvatarStack({ users, size = 20, max = 3 }: { users: WorkItemUser[]; size?: number; max?: number }) {
  if (users.length === 0) return null;
  const shown = users.slice(0, max);
  return (
    <span className="flex items-center -space-x-1.5">
      {shown.map((user) => (
        <span key={user.id} className="rounded-full ring-2 ring-bg-chat"><UserAvatar user={user} size={size} /></span>
      ))}
      {users.length > max && (
        <span className="pl-2.5 text-[11px] text-text-muted">+{users.length - max}</span>
      )}
    </span>
  );
}

export function LabelChip({ label, compact = false }: { label: WorkItemLabel; compact?: boolean }) {
  return (
    <span
      className={`inline-flex max-w-[160px] items-center truncate rounded-full border font-medium ${compact ? 'px-1.5 py-px text-[10px]' : 'px-2 py-0.5 text-xs'}`}
      style={{ color: label.color, borderColor: `${label.color}66`, backgroundColor: `${label.color}26` }}
      title={label.name}
    >
      <span className="truncate">{label.name}</span>
    </span>
  );
}

export function LabelChips({ labelIds, labels, compact }: { labelIds: string[]; labels: WorkItemLabel[]; compact?: boolean }) {
  const shown = labels.filter((label) => labelIds.includes(label.id));
  if (shown.length === 0) return null;
  return (
    <span className="flex flex-wrap items-center gap-1">
      {shown.map((label) => <LabelChip key={label.id} label={label} compact={compact} />)}
    </span>
  );
}

/** A dropdown anchored under its trigger; closes on outside click or Escape. */
export function Popover({ open, onClose, align = 'left', className = '', children }: {
  open: boolean;
  onClose: () => void;
  align?: 'left' | 'right';
  className?: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div className={`absolute top-full z-40 mt-1 w-64 rounded-lg border border-border bg-bg-elevated p-1.5 shadow-xl ${align === 'right' ? 'right-0' : 'left-0'} ${className}`}>
        {children}
      </div>
    </>
  );
}

function PickerRow({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors ${selected ? 'bg-accent/10 text-text-primary' : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'}`}
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center">{selected && <Check className="h-3.5 w-3.5 text-accent" />}</span>
      {children}
    </button>
  );
}

function PickerSearch({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <div className="relative mb-1">
      <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
      <input
        ref={ref}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded border border-border bg-bg-input py-1.5 pl-7 pr-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
      />
    </div>
  );
}

/** Multi-select list of the channel's labels. `onManage` adds an "Edit labels" footer for managers. */
export function LabelPickerList({ labels, selected, onToggle, onManage }: {
  labels: WorkItemLabel[];
  selected: string[];
  onToggle: (labelId: string) => void;
  onManage?: () => void;
}) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const visible = q ? labels.filter((label) => label.name.toLowerCase().includes(q)) : labels;
  return (
    <div>
      {labels.length > 6 && <PickerSearch value={query} onChange={setQuery} placeholder="Filter labels" />}
      <div className="max-h-56 overflow-y-auto">
        {visible.map((label) => (
          <PickerRow key={label.id} selected={selected.includes(label.id)} onClick={() => onToggle(label.id)}>
            <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: label.color }} />
            <span className="truncate">{label.name}</span>
          </PickerRow>
        ))}
        {visible.length === 0 && (
          <div className="px-2 py-3 text-center text-xs text-text-muted">{labels.length === 0 ? 'No labels yet.' : 'No matching labels.'}</div>
        )}
      </div>
      {onManage && (
        <button
          type="button"
          onClick={onManage}
          className="mt-1 flex w-full items-center gap-2 rounded border-t border-border px-2 py-1.5 text-left text-xs text-text-muted hover:bg-bg-hover hover:text-text-primary"
        >
          <Settings2 className="h-3.5 w-3.5" /> Edit labels
        </button>
      )}
    </div>
  );
}

export function MemberPickerList({ members, selected, onToggle }: {
  members: WorkItemUser[];
  selected: string[];
  onToggle: (userId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const visible = (q
    ? members.filter((member) => member.username.toLowerCase().includes(q) || (member.display_name ?? '').toLowerCase().includes(q))
    : members
  ).slice(0, 50);
  return (
    <div>
      <PickerSearch value={query} onChange={setQuery} placeholder="Find a member" />
      <div className="max-h-56 overflow-y-auto">
        {visible.map((member) => (
          <PickerRow key={member.id} selected={selected.includes(member.id)} onClick={() => onToggle(member.id)}>
            <UserAvatar user={member} size={18} />
            <span className="truncate">{userLabel(member)}</span>
          </PickerRow>
        ))}
        {visible.length === 0 && <div className="px-2 py-3 text-center text-xs text-text-muted">No members found.</div>}
      </div>
    </div>
  );
}
