import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';
import { t } from '../../i18n';

interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}

export function Modal({ open, title, onClose, children, wide }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div className="modal__backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.14 }}
                    onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
          <motion.div className={`modal ${wide ? 'modal--wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}
                      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 6 }} transition={{ duration: 0.16, ease: 'easeOut' }}>
            <div className="modal__head">
              <h2>{title}</h2>
              <button className="btn btn--ghost btn--icon" onClick={onClose} aria-label={t('common.close')}><X size={18} /></button>
            </div>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
