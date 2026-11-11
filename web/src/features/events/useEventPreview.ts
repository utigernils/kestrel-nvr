import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import type { EventItem } from '../../api/types';

interface Preview {
  /** Bild, das gerade gezeigt werden soll (null = Standbild des Ereignisses) */
  src: string | null;
  /** 0..1 - Position innerhalb der Vorschau */
  progress: number;
  loading: boolean;
}

const FRAME_MS = 260;
const cache = new Map<number, string[]>();

/** Adressen der Vorschaubilder: gespeicherte Bildfolge oder - bei alten Ereignissen - Bilder aus der Aufnahme. */
async function loadUrls(ev: EventItem): Promise<string[]> {
  const hit = cache.get(ev.id);
  if (hit && !ev.active) return hit;
  let urls: string[] = [];
  if (ev.previews > 0) {
    const r = await api.events.preview(ev.id);
    urls = r.frames.map((_, n) => api.events.previewUrl(ev.id, n));
  }
  if (urls.length < 2) {
    const n = Math.min(10, Math.max(4, Math.round((ev.end_ts - ev.start_ts) / 1500)));
    urls = Array.from({ length: n }, (_, i) => api.cameras.frameUrl(ev.camera, ev.start_ts + ((ev.end_ts - ev.start_ts) * i) / (n - 1)));
  }
  cache.set(ev.id, urls);
  return urls;
}

const preload = (url: string): Promise<boolean> => new Promise(resolve => {
  const img = new Image();
  img.onload = () => resolve(true);
  img.onerror = () => resolve(false);
  img.src = url;
});

/**
 * Spielt die Vorschau eines Ereignisses als kurze Bildfolge ab, solange `active` gesetzt ist.
 * Die Bilder werden erst beim ersten Aktivieren geladen.
 */
export function useEventPreview(ev: EventItem, active: boolean): Preview {
  const [state, setState] = useState<Preview>({ src: null, progress: 0, loading: false });

  useEffect(() => {
    if (!active) { setState({ src: null, progress: 0, loading: false }); return; }
    let alive = true;
    let timer: number | undefined;
    setState(s => ({ ...s, loading: true }));
    (async () => {
      try {
        const urls = await loadUrls(ev);
        const ok = await Promise.all(urls.map(preload));
        const good = urls.filter((_, i) => ok[i]);
        if (!alive || good.length < 2) { if (alive) setState({ src: null, progress: 0, loading: false }); return; }
        let i = 0;
        const next = () => {
          if (!alive) return;
          setState({ src: good[i], progress: (i + 1) / good.length, loading: false });
          i = (i + 1) % good.length;
          timer = window.setTimeout(next, i === 0 ? FRAME_MS * 3 : FRAME_MS);
        };
        next();
      } catch {
        if (alive) setState({ src: null, progress: 0, loading: false });
      }
    })();
    return () => { alive = false; window.clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, ev.id, ev.previews]);

  return state;
}
