import { ChevronFirst, ChevronLast, Download, Maximize, Pause, Play, ScanSearch, SkipBack, SkipForward } from 'lucide-react';
import { api } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { Segmented } from '../../components/ui/Segmented';
import { useToast } from '../../context/ToastContext';
import { t } from '../../i18n';
import type { PlayerEngine, PlayerSnapshot } from '../../lib/player/PlayerEngine';

interface PlayerControlsProps {
  engine: PlayerEngine | null;
  snapshot: PlayerSnapshot;
  onFullscreen: () => void;
  onBoxes: (v: boolean) => void;
}

const SPEEDS = [0.25, 0.5, 1, 2, 4, 8, 16];
const SPANS = [
  { value: '600000', label: '10 min' },
  { value: '3600000', label: '1 h' },
  { value: '21600000', label: '6 h' },
  { value: '86400000', label: '24 h' },
];

export function PlayerControls({ engine, snapshot, onFullscreen, onBoxes }: PlayerControlsProps) {
  const toast = useToast();
  const jump = async (dir: 1 | -1) => {
    if (!engine) return;
    try { if (!(await engine.jumpEvent(dir))) toast.info(t('rec.noMoreEvents')); } catch (e) { toast.error(e); }
  };
  const spanValue = SPANS.find(s => Number(s.value) === snapshot.span)?.value ?? '';

  return (
    <div className="controls">
      <div className="controls__group">
        <Button icon={<ChevronFirst size={18} />} onClick={() => engine?.step(-1)} aria-label={t('rec.frameBack')} title={t('rec.frameBack')} />
        <Button variant="primary" className="controls__play" icon={snapshot.playing ? <Pause size={20} /> : <Play size={20} />}
                onClick={() => engine?.toggle()} aria-label={t(snapshot.playing ? 'rec.pause' : 'rec.play')} />
        <Button icon={<ChevronLast size={18} />} onClick={() => engine?.step(1)} aria-label={t('rec.frameForward')} title={t('rec.frameForward')} />
      </div>
      <div className="controls__group">
        <Button onClick={() => engine?.seek(snapshot.t - 10_000)} title={t('rec.back10')}>−10 s</Button>
        <Button onClick={() => engine?.seek(snapshot.t + 10_000)} title={t('rec.forward10')}>+10 s</Button>
        <select className="input input--compact" value={snapshot.speed} onChange={e => engine?.setSpeed(Number(e.target.value))} aria-label={t('rec.speed')}>
          {SPEEDS.map(s => <option key={s} value={s}>{s}×</option>)}
        </select>
      </div>
      <div className="controls__group">
        <Button icon={<SkipBack size={16} />} onClick={() => jump(-1)} title={t('rec.prevEvent')}>{t('rec.event')}</Button>
        <Button icon={<SkipForward size={16} />} onClick={() => jump(1)} title={t('rec.nextEvent')}>{t('rec.event')}</Button>
      </div>
      <div className="controls__spacer" />
      <div className="controls__group">
        <Segmented label={t('rec.span')} options={SPANS} value={spanValue} onChange={v => engine?.setSpan(Number(v))} />
        <Button icon={<ScanSearch size={16} />} active={snapshot.showBoxes} onClick={() => onBoxes(!snapshot.showBoxes)} title={t('rec.boxesTitle')}>{t('common.boxes')}</Button>
        <Button icon={<Download size={16} />} disabled={!snapshot.frameTs} title={t('rec.download')}
                onClick={() => { if (engine && snapshot.frameTs) window.location.href = api.cameras.frameUrl(engine.cam, snapshot.frameTs, true); }} aria-label={t('rec.download')} />
        <Button icon={<Maximize size={16} />} onClick={onFullscreen} aria-label={t('rec.fullscreenTitle')} title={t('rec.fullscreenTitle')} />
      </div>
    </div>
  );
}
