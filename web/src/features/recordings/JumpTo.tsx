import { useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { t as tr } from '../../i18n';
import { DAY, fmtTime, isoDate } from '../../lib/format';

interface JumpToProps {
  t: number;
  onSeek: (t: number) => void;
}

/** Datum und Uhrzeit direkt anspringen, tageweise blaettern. */
export function JumpTo({ t, onSeek }: JumpToProps) {
  const dateRef = useRef<HTMLInputElement>(null);
  const timeRef = useRef<HTMLInputElement>(null);

  // Felder folgen der Wiedergabe, ausser der Benutzer tippt gerade darin.
  useEffect(() => {
    if (dateRef.current && document.activeElement !== dateRef.current) dateRef.current.value = isoDate(t);
    if (timeRef.current && document.activeElement !== timeRef.current) timeRef.current.value = fmtTime(t);
  }, [t]);

  const applyDate = (value: string) => {
    if (!value) return;
    const cur = new Date(t);
    const next = new Date(`${value}T00:00:00`);
    next.setHours(cur.getHours(), cur.getMinutes(), cur.getSeconds());
    onSeek(next.getTime());
  };
  const applyTime = (value: string) => {
    if (!value) return;
    const [h, m, s] = value.split(':').map(Number);
    const d = new Date(t);
    d.setHours(h, m, s || 0, 0);
    onSeek(d.getTime());
  };

  return (
    <div className="row">
      <Button variant="ghost" icon={<ChevronLeft size={16} />} onClick={() => onSeek(t - DAY)} aria-label={tr('rec.dayBack')} />
      <input ref={dateRef} className="input" type="date" onChange={e => applyDate(e.target.value)} aria-label={tr('events.date')} />
      <input ref={timeRef} className="input" type="time" step={1} onChange={e => applyTime(e.target.value)} aria-label={tr('rec.time')} />
      <Button variant="ghost" icon={<ChevronRight size={16} />} onClick={() => onSeek(t + DAY)} aria-label={tr('rec.dayForward')} />
      <Button variant="ghost" onClick={() => onSeek(Date.now() - 15_000)}>{tr('rec.now')}</Button>
    </div>
  );
}
