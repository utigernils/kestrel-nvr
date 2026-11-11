import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { Modal } from '../components/ui/Modal';
import { Button } from '../components/ui/Button';
import { Field } from '../components/ui/Field';
import { t } from '../i18n';

interface ConfirmOptions {
  title: string;
  text?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
}

interface PromptOptions extends ConfirmOptions {
  label: string;
  type?: 'text' | 'password';
  minLength?: number;
}

interface DialogApi {
  confirm: (o: ConfirmOptions) => Promise<boolean>;
  prompt: (o: PromptOptions) => Promise<string | null>;
}

type Pending =
  | { kind: 'confirm'; opts: ConfirmOptions; resolve: (v: boolean) => void }
  | { kind: 'prompt'; opts: PromptOptions; resolve: (v: string | null) => void };

const DialogContext = createContext<DialogApi | null>(null);

/** Ersetzt window.confirm/prompt durch eigene Dialoge im Stil der Oberflaeche. */
export function DialogProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [value, setValue] = useState('');

  const confirm = useCallback((opts: ConfirmOptions) =>
    new Promise<boolean>(resolve => setPending({ kind: 'confirm', opts, resolve })), []);
  const prompt = useCallback((opts: PromptOptions) =>
    new Promise<string | null>(resolve => { setValue(''); setPending({ kind: 'prompt', opts, resolve }); }), []);

  const close = (ok: boolean) => {
    if (!pending) return;
    if (pending.kind === 'confirm') pending.resolve(ok);
    else pending.resolve(ok ? value : null);
    setPending(null);
  };

  const api = useMemo(() => ({ confirm, prompt }), [confirm, prompt]);
  const tooShort = pending?.kind === 'prompt' && value.length < (pending.opts.minLength ?? 1);

  return (
    <DialogContext.Provider value={api}>
      {children}
      <Modal open={!!pending} title={pending?.opts.title ?? ''} onClose={() => close(false)}>
        {pending?.opts.text && <p className="muted">{pending.opts.text}</p>}
        {pending?.kind === 'prompt' && (
          <form onSubmit={e => { e.preventDefault(); if (!tooShort) close(true); }}>
            <Field label={pending.opts.label}>
              <input className="input" type={pending.opts.type ?? 'text'} value={value} autoFocus
                     autoComplete="new-password" onChange={e => setValue(e.target.value)} />
            </Field>
          </form>
        )}
        <div className="row row--end" style={{ marginTop: 18 }}>
          <Button variant="ghost" onClick={() => close(false)}>{t('common.cancel')}</Button>
          <Button variant={pending?.opts.danger ? 'danger' : 'primary'} disabled={tooShort} onClick={() => close(true)}>
            {pending?.opts.confirmLabel ?? t('common.ok')}
          </Button>
        </div>
      </Modal>
    </DialogContext.Provider>
  );
}

export function useDialog(): DialogApi {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error('useDialog ausserhalb von DialogProvider');
  return ctx;
}
