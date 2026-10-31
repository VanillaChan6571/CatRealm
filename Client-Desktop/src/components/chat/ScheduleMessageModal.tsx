import { useState, useEffect } from 'react';
import { Modal } from '../ui/Modal';

interface ScheduleMessageModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (scheduledAt: Date) => void;
  context: 'server' | 'dm';
}

function toLocalDatetimeInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// Parse a datetime-local input value as local time (avoids UTC misinterpretation)
function parseDatetimeLocal(val: string): Date | null {
  const m = val.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d, h, min] = m.map(Number);
  const date = new Date(y, mo - 1, d, h, min, 0, 0);
  return isNaN(date.getTime()) ? null : date;
}

export function ScheduleMessageModal({ open, onClose, onConfirm, context }: ScheduleMessageModalProps) {
  const maxHours = context === 'dm' ? 24 : 30 * 24;

  const getDefaults = () => {
    const now = new Date();
    const minDate = new Date(now.getTime() + 60 * 1000); // now + 1 min
    const maxDate = new Date(now.getTime() + maxHours * 60 * 60 * 1000);
    // Default to 1 hour from now (or max if less)
    const defaultDate = new Date(Math.min(now.getTime() + 60 * 60 * 1000, maxDate.getTime()));
    return { minDate, maxDate, defaultDate };
  };

  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      const { defaultDate } = getDefaults();
      setValue(toLocalDatetimeInputValue(defaultDate));
      setError(null);
    }
  }, [open]);

  const validate = (val: string): Date | null => {
    if (!val) return null;
    const date = parseDatetimeLocal(val);
    if (!date) return null;
    const { minDate, maxDate } = getDefaults();
    if (date < minDate) {
      setError('Time must be at least 1 minute in the future');
      return null;
    }
    if (date > maxDate) {
      setError(`Time must be within ${context === 'dm' ? '24 hours' : '30 days'}`);
      return null;
    }
    setError(null);
    return date;
  };

  const handleChange = (val: string) => {
    setValue(val);
    validate(val);
  };

  const handleConfirm = () => {
    const date = validate(value);
    if (!date) return;
    onConfirm(date);
  };

  const { minDate, maxDate } = getDefaults();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return (
    <Modal open={open} onClose={onClose} title="Schedule Message">
      <div className="p-4 flex flex-col gap-4">
        <p className="text-sm text-text-muted">
          Choose when to send this message. It will only be visible to you until then.
        </p>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-text-primary">Send at</label>
          <input
            type="datetime-local"
            value={value}
            min={toLocalDatetimeInputValue(minDate)}
            max={toLocalDatetimeInputValue(maxDate)}
            onChange={(e) => handleChange(e.target.value)}
            className="bg-bg-input border border-border rounded px-3 py-2 text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent"
          />
          {error && <p className="text-xs text-danger">{error}</p>}
          <p className="text-xs text-text-muted">Times are in your local timezone ({tz})</p>
          {context === 'dm' && (
            <p className="text-xs text-text-muted">DM schedules are limited to 24 hours</p>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!!error || !value}
            className="px-4 py-2 text-sm rounded bg-accent text-white hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Schedule
          </button>
        </div>
      </div>
    </Modal>
  );
}
