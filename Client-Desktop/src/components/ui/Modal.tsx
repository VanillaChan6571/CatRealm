import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useMotionProfile } from '../../lib/motion';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}

export function Modal({ open, onClose, title, children, className = '', bodyClassName = '' }: ModalProps) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const motionProfile = useMotionProfile();

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={backdropRef}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={(e) => {
            if (e.target === backdropRef.current) onClose();
          }}
          variants={motionProfile.backdropVariants}
          initial="initial"
          animate="animate"
          exit="exit"
        >
          <motion.div
            className={`bg-bg-elevated rounded-lg shadow-xl w-full max-w-lg max-h-[calc(100vh-2rem)] flex flex-col overflow-hidden ${className}`}
            variants={motionProfile.panelVariants}
            initial="initial"
            animate="animate"
            exit="exit"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h2 className="text-lg font-semibold text-text-primary">{title}</h2>
              <button
                onClick={onClose}
                className="text-text-muted hover:text-text-primary transition-colors text-xl leading-none"
              >
                &times;
              </button>
            </div>
            <div className={`flex-1 p-4 overflow-y-auto min-h-0 ${bodyClassName}`}>{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
