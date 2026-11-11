import { useState } from 'react';
import { ShieldQuestion, TriangleAlert } from 'lucide-react';
import { api } from '../../api/client';
import type { PairRequest, StorageStats } from '../../api/types';
import { Button } from '../ui/Button';
import { useToast } from '../../context/ToastContext';
import { t, tMaybe } from '../../i18n';
import { fmtCapacity } from '../../lib/format';

interface NoticesProps {
  storage: StorageStats | undefined;
  pending: PairRequest[];
  onDecided: () => void;
}

/** Text der Speicherwarnung: der Server liefert einen Code, uebersetzt wird hier. */
function storageWarning(st: StorageStats | undefined): string {
  if (!st?.warning_code) return st?.warning ?? '';
  const p = { ...st.warning_params };
  if (typeof p.days === 'number') p.span = fmtCapacity(p.days);
  if (typeof p.hours === 'number') p.hours = p.hours.toFixed(1);
  return tMaybe(`warn.${st.warning_code}`, st.warning, p);
}

/** Globale Hinweise: Speicherwarnung fuer alle, Kopplungsanfragen von Home Assistant fuer Admins. */
export function Notices({ storage, pending, onDecided }: NoticesProps) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const warning = storageWarning(storage);

  const decide = async (id: string, allow: boolean) => {
    setBusy(id);
    try {
      await api.integrations.decide(id, allow);
      toast.success(t(allow ? 'ha.allowed' : 'ha.denied'));
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
      onDecided();
    }
  };

  if (!warning && pending.length === 0) return null;
  return (
    <div className="notices">
      {warning && (
        <div className="notice notice--warn" role="alert">
          <TriangleAlert size={17} />
          <span>{warning}</span>
        </div>
      )}
      {pending.map(p => (
        <div key={p.id} className="notice notice--pair" role="alert">
          <ShieldQuestion size={22} className="notice__icon" />
          <div className="notice__body">
            <div>{t('ha.request', { name: p.name, ip: p.ip })}</div>
            <div className="small muted">
              {t('ha.requestHint')}
              <span className="code">{p.code.slice(0, 3)} {p.code.slice(3)}</span>
            </div>
          </div>
          <div className="row">
            <Button variant="primary" disabled={busy === p.id} onClick={() => decide(p.id, true)}>{t('ha.allow')}</Button>
            <Button variant="ghost" disabled={busy === p.id} onClick={() => decide(p.id, false)}>{t('ha.deny')}</Button>
          </div>
        </div>
      ))}
    </div>
  );
}
