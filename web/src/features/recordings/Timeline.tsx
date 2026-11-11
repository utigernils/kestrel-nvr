import { useEffect, useRef } from 'react';
import { t } from '../../i18n';
import { drawTimeline } from '../../lib/player/drawTimeline';
import type { PlayerEngine } from '../../lib/player/PlayerEngine';

interface TimelineProps { engine: PlayerEngine | null }

/** Zeitleiste: ziehen = spulen, Mausrad oder Zwei-Finger-Geste = zoomen. */
export function Timeline({ engine }: TimelineProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hover = useRef<number | null>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas || !engine) return;

    const size = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(wrap.clientWidth * dpr);
      canvas.height = Math.round(wrap.clientHeight * dpr);
    };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(wrap);
    const off = engine.onFrame(() => drawTimeline(canvas, engine, hover.current));

    const timeAt = (clientX: number): number => {
      const r = wrap.getBoundingClientRect();
      return engine.v0 + ((clientX - r.left) / r.width) * engine.span;
    };
    let dragging = false;
    const down = (e: PointerEvent) => { dragging = true; wrap.setPointerCapture(e.pointerId); engine.seek(timeAt(e.clientX)); };
    const move = (e: PointerEvent) => {
      hover.current = e.pointerType === 'mouse' ? e.clientX - wrap.getBoundingClientRect().left : null;
      if (dragging) engine.seek(timeAt(e.clientX));
    };
    const up = () => { dragging = false; };
    const leave = () => { hover.current = null; };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) engine.pan((e.deltaX / wrap.clientWidth) * engine.span);
      else engine.zoomAt(timeAt(e.clientX), e.deltaY > 0 ? 1.3 : 1 / 1.3);
    };
    wrap.addEventListener('pointerdown', down);
    wrap.addEventListener('pointermove', move);
    wrap.addEventListener('pointerup', up);
    wrap.addEventListener('pointercancel', up);
    wrap.addEventListener('pointerleave', leave);
    wrap.addEventListener('wheel', wheel, { passive: false });
    return () => {
      ro.disconnect();
      off();
      wrap.removeEventListener('pointerdown', down);
      wrap.removeEventListener('pointermove', move);
      wrap.removeEventListener('pointerup', up);
      wrap.removeEventListener('pointercancel', up);
      wrap.removeEventListener('pointerleave', leave);
      wrap.removeEventListener('wheel', wheel);
    };
  }, [engine]);

  return (
    <div className="timeline" ref={wrapRef} role="slider" aria-label={t('rec.timeline')} aria-valuenow={engine ? Math.round(engine.t) : 0} tabIndex={-1}>
      <canvas ref={canvasRef} />
    </div>
  );
}
