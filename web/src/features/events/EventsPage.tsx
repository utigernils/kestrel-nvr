import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SearchX } from 'lucide-react';
import { api } from '../../api/client';
import type { EventItem } from '../../api/types';
import { Button } from '../../components/ui/Button';
import { Empty } from '../../components/ui/Empty';
import { Loader } from '../../components/ui/Loader';
import { PageHeader } from '../../components/ui/PageHeader';
import { useAuth } from '../../context/AuthContext';
import { useDialog } from '../../context/DialogContext';
import { useToast } from '../../context/ToastContext';
import { usePolling } from '../../hooks/usePolling';
import { DAY, dayStart, fmtDayLabel } from '../../lib/format';
import { t } from '../../i18n';
import { labelColor, labelName } from '../../lib/labels';
import { EventCard } from './EventCard';

const PAGE = 120;

export default function EventsPage() {
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const dialog = useDialog();
  const toast = useToast();
  const [camera, setCamera] = useState('');
  const [label, setLabel] = useState('');
  const [date, setDate] = useState('');
  const [limit, setLimit] = useState(PAGE);

  const { data: cameras } = usePolling(useCallback(signal => api.cameras.list(signal), []), 30_000);
  const { data: labels } = usePolling(useCallback(() => api.events.labels(), []), 60_000);
  const { data: events, loading, reload } = usePolling(useCallback(() => {
    const start = date ? new Date(`${date}T00:00:00`).getTime() : undefined;
    return api.events.list({ camera, label, start, end: start ? start + DAY : undefined, limit });
  }, [camera, label, date, limit]), 15_000, [camera, label, date, limit]);

  const groups = useMemo(() => {
    const out: { day: number; items: EventItem[] }[] = [];
    for (const e of events ?? []) {
      const day = dayStart(e.start_ts);
      if (!out.length || out[out.length - 1].day !== day) out.push({ day, items: [] });
      out[out.length - 1].items.push(e);
    }
    return out;
  }, [events]);

  const open = useCallback((e: EventItem) => navigate(`/rec/${e.camera}/${e.start_ts - 2000}`), [navigate]);
  const remove = useCallback(async (e: EventItem) => {
    const ok = await dialog.confirm({ title: t('events.deleteTitle'), text: t('events.deleteText'), confirmLabel: t('common.delete'), danger: true });
    if (!ok) return;
    try { await api.events.remove(e.id); reload(); } catch (err) { toast.error(err); }
  }, [dialog, reload, toast]);

  return (
    <>
      <PageHeader title={t('nav.events')} subtitle={t('events.hint')}>
        <select className="input" value={camera} onChange={e => setCamera(e.target.value)} aria-label={t('common.camera')}>
          <option value="">{t('common.allCameras')}</option>
          {cameras?.map(c => <option key={c.name}>{c.name}</option>)}
        </select>
        <input className="input" type="date" value={date} onChange={e => setDate(e.target.value)} aria-label={t('events.date')} />
        {date && <Button variant="ghost" onClick={() => setDate('')}>{t('events.allDays')}</Button>}
      </PageHeader>

      <div className="chips">
        <button className={`chip ${label === '' ? 'is-on' : ''}`} onClick={() => setLabel('')}>{t('events.all')}</button>
        {labels?.map(l => (
          <button key={l} className={`chip ${label === l ? 'is-on' : ''}`} onClick={() => setLabel(label === l ? '' : l)}>
            <i className="chip__dot" style={{ background: labelColor(l) }} />{labelName(l)}
          </button>
        ))}
      </div>

      {loading && !events ? <Loader /> : groups.length === 0 ? (
        <Empty icon={<SearchX size={34} />} title={t('events.none')}>{t('events.noneHint')}</Empty>
      ) : (
        <>
          {groups.map(g => (
            <section key={g.day}>
              <h2 className="day-head">{fmtDayLabel(g.day)} <span className="muted">· {g.items.length}</span></h2>
              <div className="events">
                {g.items.map(e => <EventCard key={e.id} event={e} canDelete={isAdmin} onOpen={open} onDelete={remove} />)}
              </div>
            </section>
          ))}
          {(events?.length ?? 0) >= limit && (
            <div className="row row--center" style={{ marginTop: 20 }}>
              <Button onClick={() => setLimit(l => l + PAGE)}>{t('events.more')}</Button>
            </div>
          )}
        </>
      )}
    </>
  );
}
