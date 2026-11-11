import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CheckCircle2, Info, TriangleAlert } from 'lucide-react';

type Kind = 'info' | 'success' | 'error';
interface Toast { id: number; kind: Kind; text: string }

interface ToastApi {
  info: (text: string) => void;
  success: (text: string) => void;
  error: (text: string | unknown) => void;
}

const ToastContext = createContext<ToastApi | null>(null);
const ICONS = { info: Info, success: CheckCircle2, error: TriangleAlert };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const push = useCallback((kind: Kind, text: string) => {
    const id = ++seq.current;
    setToasts(t => [...t.slice(-3), { id, kind, text }]);
    window.setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), kind === 'error' ? 5000 : 2800);
  }, []);

  const value = useMemo<ToastApi>(() => ({
    info: t => push('info', t),
    success: t => push('success', t),
    error: t => push('error', t instanceof Error ? t.message : String(t)),
  }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        <AnimatePresence>
          {toasts.map(t => {
            const Icon = ICONS[t.kind];
            return (
              <motion.div
                key={t.id}
                className={`toast toast--${t.kind}`}
                initial={{ opacity: 0, y: 16, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.96 }}
                transition={{ type: 'spring', stiffness: 380, damping: 28 }}
              >
                <Icon size={16} />
                <span>{t.text}</span>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast ausserhalb von ToastProvider');
  return ctx;
}
