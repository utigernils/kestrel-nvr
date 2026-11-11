import { memo, useState } from 'react';
import { Pause, Play, Trash2 } from 'lucide-react';
import { api } from '../../api/client';
import type { EventItem } from '../../api/types';
import { Badge } from '../../components/ui/Badge';
import { fmtDuration, fmtTime } from '../../lib/format';
import { LabelName } from '../../components/ui/LabelName';
import { t } from '../../i18n';
import { labelName } from '../../lib/labels';
import { useEventPreview } from './useEventPreview';

interface EventCardProps {
  event: EventItem;
  canDelete: boolean;
  onOpen: (e: EventItem) => void;
  onDelete: (e: EventItem) => void;
}

/**
 * Ereignis-Karte. Am Rechner spielt die Vorschau, sobald der Mauszeiger darueber ist; auf dem
 * Handy ueber den Abspiel-Knopf. Ein Klick aufs Bild oeffnet die Stelle im Player.
 */
export const EventCard = memo(function EventCard({ event, canDelete, onOpen, onDelete }: EventCardProps) {
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const preview = useEventPreview(event, hover || pinned);

  const media = (
    <div className="event__media">
      <img src={api.events.thumbUrl(event)} alt="" loading="lazy" className="event__thumb" />
      {preview.src && <img src={preview.src} alt="" className="event__preview" />}
      {(preview.src || preview.loading) && (
        <div className="event__bar"><i style={{ width: `${preview.loading ? 8 : preview.progress * 100}%` }} /></div>
      )}
    </div>
  );

  return (
    <article className="event" onPointerEnter={e => { if (e.pointerType === 'mouse') setHover(true); }} onPointerLeave={() => setHover(false)}>
      <button className="event__open" onClick={() => onOpen(event)} aria-label={t('events.open', { label: labelName(event.label), time: fmtTime(event.start_ts) })}>
        {media}
      </button>
      <div className="event__tools">
        <button className="event__tool" onClick={() => setPinned(p => !p)} aria-label={t(pinned ? 'events.previewStop' : 'events.previewPlay')}>
          {pinned ? <Pause size={14} /> : <Play size={14} />}
        </button>
        {canDelete && (
          <button className="event__tool event__tool--danger" onClick={() => onDelete(event)} aria-label={t('events.deleteAria')}><Trash2 size={14} /></button>
        )}
      </div>
      <div className="event__meta">
        <div className="event__line">
          <span className="event__label"><LabelName label={event.label} /></span>
          <span className="muted">{Math.round(event.score * 100)}%</span>
          {event.active ? <Badge tone="bad">{t('events.running')}</Badge> : null}
        </div>
        <div className="small muted">{fmtTime(event.start_ts)} · {fmtDuration((event.end_ts - event.start_ts) / 1000)} · {event.camera}</div>
      </div>
    </article>
  );
});
