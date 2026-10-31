import { useEffect, useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { useUIStore } from '../../stores/uiStore';
import { useKeybindStore } from '../../stores/keybindStore';
import {
  KEYBIND_ACTIONS,
  KEYBIND_CATEGORIES,
  formatKeyCombo,
  isReservedCtrlK,
  normalizeKeyboardEventToCombo,
  type KeyCombo,
} from '../../lib/keybinds';

type CaptureTarget = { actionId: string; slotIndex: number } | null;

function KeyPill({ label, active = false }: { label: string; active?: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-1 text-xs font-semibold leading-none ${
        active
          ? 'border-accent/60 bg-accent/20 text-white'
          : 'border-border bg-bg-input text-text-secondary'
      }`}
    >
      {label}
    </span>
  );
}

function ComboButton({
  combo,
  onClick,
  disabled,
  listening,
}: {
  combo: KeyCombo | null;
  onClick: () => void;
  disabled?: boolean;
  listening?: boolean;
}) {
  const labels = combo ? formatKeyCombo(combo) : ['UNASSIGNED'];
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex flex-wrap gap-1 rounded-lg p-1 transition-colors ${
        disabled
          ? 'cursor-not-allowed opacity-70'
          : listening
            ? 'bg-accent/10 ring-1 ring-accent/40'
            : 'hover:bg-bg-hover'
      }`}
      title={disabled ? 'This keybind is reserved and cannot be changed.' : 'Click to rebind'}
    >
      {labels.map((label) => (
        <KeyPill key={`${label}-${labels.length}`} label={label} active={listening} />
      ))}
    </button>
  );
}

export function KeybindsModal() {
  const activeModal = useUIStore((s) => s.activeModal);
  const closeModal = useUIStore((s) => s.closeModal);
  const bindings = useKeybindStore((s) => s.bindings);
  const setBinding = useKeybindStore((s) => s.setBinding);
  const resetAction = useKeybindStore((s) => s.resetAction);
  const resetAll = useKeybindStore((s) => s.resetAll);

  const open = activeModal === 'keybinds';
  const [capturing, setCapturing] = useState<CaptureTarget>(null);
  const [captureMessage, setCaptureMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setCapturing(null);
      setCaptureMessage(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open || !capturing) return;
    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const combo = normalizeKeyboardEventToCombo(e);
      if (!combo) {
        return;
      }
      if (isReservedCtrlK(combo)) {
        setCaptureMessage('Ctrl+K is reserved for opening the Keybind Menu.');
        return;
      }
      setBinding(capturing.actionId, capturing.slotIndex, combo);
      setCaptureMessage(null);
      setCapturing(null);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [open, capturing, setBinding]);

  if (!open) return null;

  return (
    <Modal
      open={open}
      onClose={closeModal}
      title="Keybinds"
      className="!max-w-[min(96vw,1320px)] h-[calc(100vh-2rem)]"
    >
      <div className="space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm text-text-secondary">
              Press <span className="font-semibold text-text-primary">Ctrl+K</span> anytime to open this menu.
            </p>
            <p className="text-xs text-text-muted">
              Click a shortcut pill to rebind it. Press the new key combination once to save.
            </p>
            {captureMessage && (
              <p className="mt-2 text-xs text-warning">{captureMessage}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {capturing && (
              <Button type="button" variant="secondary" size="sm" onClick={() => { setCapturing(null); setCaptureMessage(null); }}>
                Cancel Rebind
              </Button>
            )}
            <Button type="button" variant="secondary" size="sm" onClick={resetAll}>
              Reset All
            </Button>
          </div>
        </div>

        {KEYBIND_CATEGORIES.map((category) => {
          const actions = KEYBIND_ACTIONS.filter((a) => a.categoryId === category.id);
          return (
            <section key={category.id} className="space-y-3">
              <div>
                <h3 className="text-2xl font-semibold text-text-primary">{category.title}</h3>
                {category.description && (
                  <p className="text-sm text-text-secondary mt-1">{category.description}</p>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                {actions.map((action) => {
                  const defaultSlots = action.defaultCombos.length;
                  const actionBindings = bindings[action.id] ?? action.defaultCombos;
                  const slots = Array.from({ length: defaultSlots }, (_, idx) => actionBindings[idx] ?? null);
                  const editable = action.editable !== false;
                  return (
                    <div
                      key={action.id}
                      className="rounded-xl border border-border/70 bg-bg-elevated/60 p-4 min-h-[124px] flex flex-col"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-medium text-text-primary leading-snug">{action.label}</p>
                        {editable && (
                          <button
                            type="button"
                            onClick={() => resetAction(action.id)}
                            className="text-[11px] text-text-muted hover:text-text-primary"
                          >
                            Reset
                          </button>
                        )}
                      </div>
                      {action.helperText && (
                        <p className="mt-1 text-[11px] leading-snug text-text-muted">{action.helperText}</p>
                      )}
                      <div className="mt-3 flex flex-wrap gap-1">
                        {slots.map((slotCombo, slotIndex) => {
                          const listening = capturing?.actionId === action.id && capturing.slotIndex === slotIndex;
                          return (
                            <div key={`${action.id}-${slotIndex}`} className="flex items-center gap-1">
                              <ComboButton
                                combo={slotCombo}
                                onClick={() => {
                                  if (!editable) return;
                                  setCaptureMessage(null);
                                  setCapturing({ actionId: action.id, slotIndex });
                                }}
                                disabled={!editable}
                                listening={listening}
                              />
                              {editable && (
                                <button
                                  type="button"
                                  className="text-xs text-text-muted hover:text-text-primary px-1"
                                  onClick={() => setBinding(action.id, slotIndex, null)}
                                  title="Clear binding"
                                >
                                  ×
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </Modal>
  );
}
