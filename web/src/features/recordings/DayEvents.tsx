import { useCallback } from 'react';
import { api } from '../../api/client';
import type { EventItem } from '../../api/types';
import { usePolling } from '../../hooks/usePolling';
import { DAY, fmtDayLabel, fmtDuration, fmtTime } from '../../lib/format';
import { LabelName } from '../../components/ui/LabelName';
import { t } from '../../i18n';

interface DayEventsProps {
  camera: string;
  day: number;
  currentTs: number;
  onSelect: (e: EventItem) => void;
}

/** Ereignisse des Tages neben dem Player - ein Klick springt zur Stelle. */
export function DayEvents({ camera, day, currentTs, onSelect }: DayEventsProps) {
  const { data } = usePolling(
    useCallback(() => api.events.list({ camera, start: day, end: day + DAY, order: 'asc', limit: 500 }), [camera, day]),
    20_000, [camera, day],
  );
  const events = data ?? [];
  return (
    <aside className="dayevents">
      <h2 className="dayevents__head">{fmtDayLabel(day)} <span className="muted">· {t('rec.dayEvents', { count: events.length })}</span></h2>
      {events.length === 0 && <p className="muted small">{t('rec.dayNone')}</p>}
      <ul>
        {events.map(e => {
          const current = currentTs >= e.start_ts - 2500 && currentTs <= e.end_ts + 1000;
          return (
            <li key={e.id}>
              <button className={`dayevent ${current ? 'is-current' : ''}`} onClick={() => onSelect(e)}>
                <img src={api.events.thumbUrl(e)} alt="" loading="lazy" />
                <span className="dayevent__text">
                  <b><LabelName label={e.label} /></b>
                  <span className="small muted">{fmtTime(e.start_ts)} · {fmtDuration((e.end_ts - e.start_ts) / 1000)}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
