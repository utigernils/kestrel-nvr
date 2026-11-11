import { useEffect, useRef } from 'react';
import { Maximize2 } from 'lucide-react';
import { api } from '../../api/client';
import type { Camera } from '../../api/types';
import { Badge, StatusDot } from '../../components/ui/Badge';
import { t, tMaybe } from '../../i18n';
import { drawBoxes, fitRect } from '../../lib/draw';

interface CameraTileProps {
  camera: Camera;
  /** Bildrate der Vorschau begrenzen (in der Uebersicht), 0 = alles */
  maxFps: number;
  showBoxes: boolean;
  focused: boolean;
  onOpen?: () => void;
}

/** Live-Bild einer Kamera (M-JPEG) mit darueber gelegten Erkennungs-Boxen. */
export function CameraTile({ camera, maxFps, showBoxes, focused, onOpen }: CameraTileProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // Die Verbindung zum Live-Strom beim Verlassen ausdruecklich schliessen.
  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    img.src = api.cameras.liveUrl(camera.name, maxFps || undefined);
    return () => { img.src = ''; };
  }, [camera.name, maxFps]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    const box = boxRef.current;
    if (!canvas || !img || !box) return;
    const ctx = canvas.getContext('2d')!;
    let alive = true;
    const draw = async () => {
      const dpr = window.devicePixelRatio || 1;
      const w = Math.round(box.clientWidth * dpr);
      const h = Math.round(box.clientHeight * dpr);
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      ctx.clearRect(0, 0, w, h);
      if (!showBoxes || !camera.detect || !img.naturalWidth || document.hidden) return;
      try {
        const d = await api.cameras.liveDetections(camera.name);
        if (!alive || d.now - d.ts > 2500) return;
        ctx.clearRect(0, 0, w, h);
        drawBoxes(ctx, d.dets, fitRect(w, h, img.naturalWidth, img.naturalHeight), dpr);
      } catch { /* naechster Versuch */ }
    };
    const timer = window.setInterval(draw, 500);
    return () => { alive = false; window.clearInterval(timer); };
  }, [camera.name, camera.detect, showBoxes]);

  const online = camera.state === 'online';
  return (
    <div ref={boxRef} className={`tile ${focused ? 'tile--focused' : ''}`} onClick={onOpen} role={onOpen ? 'button' : undefined} tabIndex={onOpen ? 0 : undefined}
         onKeyDown={e => { if (onOpen && (e.key === 'Enter' || e.key === ' ')) onOpen(); }}>
      <img ref={imgRef} alt={t('live.imageAlt', { name: camera.name })} />
      <canvas ref={canvasRef} />
      <div className="tile__top">
        <Badge><StatusDot state={camera.state} /><b>{camera.name}</b></Badge>
        {online && (
          <Badge>
            {camera.codec && camera.codec !== 'mjpeg' ? `${camera.codec.toUpperCase()} · ` : ''}{camera.width ? `${camera.width}×${camera.height} · ` : ''}{camera.fps.toFixed(1)} {t('unit.fps')} · {(camera.kbps / 1000).toFixed(1)} Mbit/s
          </Badge>
        )}
        {!online && <Badge tone="warn">{tMaybe(`state.${camera.state}`, camera.state)}</Badge>}
      </div>
      {onOpen && <div className="tile__hint"><Maximize2 size={15} /></div>}
      {!online && !camera.last_ts && <div className="tile__msg">{camera.error || t('live.connecting')}</div>}
    </div>
  );
}
