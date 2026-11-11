import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { VideoOff } from 'lucide-react';
import { api } from '../../api/client';
import type { EventItem } from '../../api/types';
import { Empty } from '../../components/ui/Empty';
import { Loader } from '../../components/ui/Loader';
import { PageHeader } from '../../components/ui/PageHeader';
import { usePrefs } from '../../context/PrefsContext';
import { usePolling } from '../../hooks/usePolling';
import { t as tr } from '../../i18n';
import { dayStart } from '../../lib/format';
import { DayEvents } from './DayEvents';
import { JumpTo } from './JumpTo';
import { PlayerControls } from './PlayerControls';
import { PlayerStage } from './PlayerStage';
import { Timeline } from './Timeline';
import { usePlayerEngine, usePlayerSnapshot } from './usePlayerEngine';

export default function RecordingsPage() {
  const params = useParams();
  const navigate = useNavigate();
  const { showBoxes, setShowBoxes } = usePrefs();
  const { data: cameras, loading } = usePolling(useCallback(signal => api.cameras.list(signal), []), 30_000);

  const camera = useMemo(() => {
    if (!cameras?.length) return '';
    return cameras.some(c => c.name === params.cam) ? params.cam! : cameras[0].name;
  }, [cameras, params.cam]);
  const startTs = Number(params.ts) || 0;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const engine = usePlayerEngine(camera, startTs, canvasRef, showBoxes);
  const snap = usePlayerSnapshot(engine);

  const fullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void stageRef.current?.requestFullscreen?.();
  }, []);
  const setBoxes = useCallback((v: boolean) => { setShowBoxes(v); engine?.setShowBoxes(v); }, [engine, setShowBoxes]);

  // Tastenkuerzel
  useEffect(() => {
    if (!engine) return;
    const onKey = (e: KeyboardEvent) => {
      if (/INPUT|SELECT|TEXTAREA/.test((e.target as HTMLElement).tagName) || e.metaKey || e.ctrlKey) return;
      switch (e.key) {
        case ' ': e.preventDefault(); engine.toggle(); break;
        case 'ArrowLeft': engine.step(-1); break;
        case 'ArrowRight': engine.step(1); break;
        case 'j': case 'J': engine.seek(engine.t - 10_000); break;
        case 'l': case 'L': engine.seek(engine.t + 10_000); break;
        case 'b': case 'B': setBoxes(!engine.showBoxes); break;
        case 'f': case 'F': fullscreen(); break;
        default:
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [engine, fullscreen, setBoxes]);

  const selectEvent = useCallback((e: EventItem) => {
    if (!engine) return;
    engine.seek(e.start_ts - 2000, true);
    if (!engine.playing) engine.toggle();
  }, [engine]);

  if (loading && !cameras) return <Loader />;
  if (!cameras?.length) return <Empty icon={<VideoOff size={34} />} title={tr('live.noCamera')} />;

  const t = snap.t || startTs || Date.now();
  return (
    <>
      <PageHeader title={tr('rec.title')}>
        <select className="input" value={camera} aria-label={tr('common.camera')} onChange={e => navigate(`/rec/${e.target.value}/${Math.round(t)}`)}>
          {cameras.map(c => <option key={c.name}>{c.name}</option>)}
        </select>
        <JumpTo t={t} onSeek={ts => engine?.seek(ts, true)} />
      </PageHeader>
      <div className="player">
        <div className="player__main">
          <PlayerStage engine={engine} snapshot={snap} canvasRef={canvasRef} stageRef={stageRef} />
          <Timeline engine={engine} />
          <PlayerControls engine={engine} snapshot={snap} onFullscreen={fullscreen} onBoxes={setBoxes} />
          <p className="small muted player__keys">{tr('rec.keys')}</p>
        </div>
        <DayEvents camera={camera} day={dayStart(t)} currentTs={t} onSelect={selectEvent} />
      </div>
    </>
  );
}
