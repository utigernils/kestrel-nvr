import { useEffect, useState, useSyncExternalStore, type RefObject } from 'react';
import { PlayerEngine, type PlayerSnapshot } from '../../lib/player/PlayerEngine';

/** Erzeugt die Wiedergabe-Engine fuer eine Kamera und raeumt sie beim Wechsel wieder ab. */
export function usePlayerEngine(cam: string, startTs: number, canvasRef: RefObject<HTMLCanvasElement | null>, showBoxes: boolean): PlayerEngine | null {
  const [engine, setEngine] = useState<PlayerEngine | null>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !cam) return;
    const e = new PlayerEngine(cam, startTs, canvas);
    e.showBoxes = showBoxes;
    e.resize();
    setEngine(e);
    return () => { e.destroy(); setEngine(null); };
    // showBoxes wird nur als Startwert gebraucht
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cam, startTs, canvasRef]);
  return engine;
}

const EMPTY: PlayerSnapshot = {
  t: 0, playing: false, speed: 1, showBoxes: true, message: '', frameTs: 0, fps: null, frameBytes: 0,
  width: null, height: null, codec: '', span: 3_600_000,
};
const noop = () => () => {};
const empty = () => EMPTY;

/** Schnappschuss des Player-Zustands fuer die Bedienelemente (einige Male pro Sekunde aktualisiert). */
export function usePlayerSnapshot(engine: PlayerEngine | null): PlayerSnapshot {
  return useSyncExternalStore(engine ? engine.subscribe : noop, engine ? engine.getSnapshot : empty);
}
