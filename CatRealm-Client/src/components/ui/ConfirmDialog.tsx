import type { ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Button } from './Button';
import { useMotionProfile } from '../../lib/motion';

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string | ReactNode;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'primary';
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'danger'
}: ConfirmDialogProps) {
  const motionProfile = useMotionProfile();

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          variants={motionProfile.backdropVariants}
          initial="initial"
          animate="animate"
          exit="exit"
        >
          <motion.div
            className="bg-bg-elevated rounded-lg shadow-xl w-full mx-4 max-w-md"
            variants={motionProfile.panelVariants}
            initial="initial"
            animate="animate"
            exit="exit"
          >
            <div className="px-5 py-4 border-b border-border">
              <h2 className="text-lg font-semibold text-text-primary">{title}</h2>
            </div>
            <div className="p-5">
              <p className="text-text-secondary text-sm">{message}</p>
            </div>
            <div className="px-5 py-4 bg-bg-secondary flex justify-end gap-3 rounded-b-lg">
              <Button variant="secondary" size="sm" onClick={onClose}>
                {cancelText}
              </Button>
              <Button
                variant={variant}
                size="sm"
                onClick={() => {
                  onConfirm();
                  onClose();
                }}
              >
                {confirmText}
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
