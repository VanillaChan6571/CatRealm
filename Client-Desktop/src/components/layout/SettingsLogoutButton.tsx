import { useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { LogOut, Settings } from 'lucide-react';
import { useUIStore } from '../../stores/uiStore';

const SECRET_HOLD_MS = 2000;

// Opens voice settings. Hovering it while holding Shift for two seconds turns
// it into a Log Out button until the pointer leaves.
export function SettingsLogoutButton() {
  const openModal = useUIStore((s) => s.openModal);
  const [hovered, setHovered] = useState(false);
  const [holding, setHolding] = useState(false);
  const [secret, setSecret] = useState(false);
  const timer = useRef<number | null>(null);

  const cancelHold = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
  };

  const startHold = () => {
    if (timer.current !== null || secret) return;
    setHolding(true);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setHolding(false);
      setSecret(true);
    }, SECRET_HOLD_MS);
  };

  useEffect(() => {
    if (!hovered) return;
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Shift') startHold(); };
    const onKeyUp = (e: KeyboardEvent) => { if (e.key === 'Shift') cancelHold(); };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', cancelHold);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', cancelHold);
    };
  });

  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);

  const handleEnter = (e: ReactMouseEvent) => {
    setHovered(true);
    if (e.shiftKey) startHold();
  };

  const handleLeave = () => {
    setHovered(false);
    cancelHold();
    setSecret(false);
  };

  const label = secret ? 'Log Out' : 'Voice Settings';

  return (
    <button
      type="button"
      data-tour="settings"
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onClick={() => (secret ? openModal('confirmLogout') : openModal('profileSettings', { initialTab: 'voice' }))}
      className={`relative w-6 h-6 shrink-0 flex items-center justify-center rounded transition-colors duration-300 ${
        secret ? 'text-danger hover:bg-danger/15' : 'text-text-muted hover:text-text-primary'
      }`}
      title={label}
      aria-label={label}
    >
      <Settings
        size={16}
        className={`absolute transition-all ease-out ${
          secret ? 'opacity-0 scale-50 rotate-180 duration-300' : holding ? 'rotate-[270deg] duration-[2000ms]' : 'duration-300'
        }`}
      />
      <LogOut
        size={16}
        className={`absolute transition-all duration-300 ease-out ${secret ? 'opacity-100 scale-100' : 'opacity-0 scale-50'}`}
      />
    </button>
  );
}
