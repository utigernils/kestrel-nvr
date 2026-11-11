import { useCallback } from 'react';
import { Unplug } from 'lucide-react';
import { api } from '../../api/client';
import type { HaClient } from '../../api/types';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { useDialog } from '../../context/DialogContext';
import { useToast } from '../../context/ToastContext';
import { usePolling } from '../../hooks/usePolling';
import { t } from '../../i18n';
import { fmtDate, relativeTime } from '../../lib/format';

export function HomeAssistantSection() {
  const toast = useToast();
  const dialog = useDialog();
  const { data, reload } = usePolling(useCallback(() => api.integrations.list(), []), 8000);
  const clients = data?.clients ?? [];

  const revoke = async (c: HaClient) => {
    const ok = await dialog.confirm({
      title: t('ha.revokeTitle', { name: c.name }), text: t('ha.revokeText'), confirmLabel: t('ha.revoke'), danger: true,
    });
    if (!ok) return;
    try { await api.integrations.revoke(c.id); reload(); } catch (e) { toast.error(e); }
  };

  return (
    <Card title={t('set.tab.ha')} padded={false}>
      <p className="muted card__text">{t('ha.text')}</p>
      <div className="scroll">
        <table className="table">
          <thead><tr><th>{t('ha.col.name')}</th><th>{t('ha.col.address')}</th><th>{t('ha.col.approvedBy')}</th><th>{t('ha.col.since')}</th><th>{t('ha.col.lastSeen')}</th><th /></tr></thead>
          <tbody>
            {clients.map(c => (
              <tr key={c.id}>
                <td><b>{c.name}</b></td>
                <td>{c.ip ?? '–'}</td>
                <td>{c.approved_by ?? '–'}</td>
                <td>{fmtDate(c.created * 1000)}</td>
                <td>{c.last_seen ? relativeTime(c.last_seen * 1000) : t('rel.never')}</td>
                <td className="table__actions"><Button size="sm" variant="danger" icon={<Unplug size={14} />} onClick={() => revoke(c)}>{t('ha.revoke')}</Button></td>
              </tr>
            ))}
            {clients.length === 0 && <tr><td colSpan={6} className="muted">{t('ha.empty')}</td></tr>}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
