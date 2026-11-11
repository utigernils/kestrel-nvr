import { useEffect, type RefObject } from 'react';
import { Badge } from '../../components/ui/Badge';
import { t, tMaybe } from '../../i18n';
import { fmtBytes, fmtDate, fmtTime } from '../../lib/format';
import type { PlayerEngine, PlayerSnapshot } from '../../lib/player/PlayerEngine';

interface PlayerStageProps {
  engine: PlayerEngine | null;
  snapshot: PlayerSnapshot;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  stageRef: RefObject<HTMLDivElement | null>;
}

/** Bildflaeche des Players: Canvas, Einblendungen, Klick = Wiedergabe/Pause. */
export function PlayerStage({ engine, snapshot, canvasRef, stageRef }: PlayerStageProps) {
  useEffect(() => {
    const el = stageRef.current;
    if (!el || !engine) return;
    const ro = new ResizeObserver(() => engine.resize());
    ro.observe(el);
    return () => ro.disconnect();
  }, [engine, stageRef]);

  return (
    <div className="stage" ref={stageRef} onClick={() => engine?.toggle()}>
      <canvas ref={canvasRef} />
      <div className="stage__osd">
        <Badge>{snapshot.frameTs ? `${fmtDate(snapshot.frameTs)}  ${fmtTime(snapshot.frameTs, true)}` : '–'}</Badge>
        {snapshot.fps != null && <Badge>{t('rec.fps', { fps: snapshot.fps.toFixed(1) })}</Badge>}
        {snapshot.width != null && <Badge>{snapshot.width}×{snapshot.height}{snapshot.frameBytes ? ` · ${fmtBytes(snapshot.frameBytes)}` : ''}</Badge>}
        {snapshot.codec && <Badge>{tMaybe(`rec.codec.${snapshot.codec}`, snapshot.codec)}</Badge>}
      </div>
      {snapshot.message && <div className="stage__msg">{tMaybe(`rec.msg.${snapshot.message}`, snapshot.message)}</div>}
    </div>
  );
}
