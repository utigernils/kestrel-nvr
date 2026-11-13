import { api } from '../../api/client';
import type { DetectionRow, EventItem, TimelineEntry } from '../../api/types';
import { drawBoxes, fitRect, type DrawBox } from '../draw';
import { MIN } from '../format';

/**
 * Wiedergabe mit variabler Bildrate.
 *
 * Es gibt keinen Videostrom: Der Server liefert pro Minute eine Liste von Zeitstempeln und auf
 * Anfrage einzelne Bilder. Die Engine laesst eine "Medienuhr" laufen und zeigt jeweils das letzte
 * Bild, dessen Zeitstempel erreicht ist - so entstehen exakt die Abstaende der Aufnahme. Bilder
 * werden vorausgeladen und auf Anzeigegroesse dekodiert.
 *
 * Schnelle Wiedergabe (ueber 2x): Es werden nicht mehr alle Bilder geladen, sondern so viele, wie
 * Netz und Dekoder schaffen - der Abstand richtet sich nach der gemessenen Ladezeit. Geladen wird
 * mit Vorlauf (die Uhr ist beim Eintreffen schon weiter). Kommt trotzdem laenger als eine Sekunde
 * kein neues Bild, wartet die Uhr, statt blind weiterzulaufen. Bewusst ohne React gebaut: der
 * Bildwechsel laeuft in requestAnimationFrame, React bekommt nur wenige Male pro Sekunde einen
 * Schnappschuss fuer die Bedienelemente.
 */

interface IndexEntry {
  ts: number[] | null;
  len: number[] | null;
  codec: string;
  busy: boolean;
  at: number;
}

interface DetGroup { ts: number; d: DetectionRow[] }
interface DetEntry { groups: DetGroup[] | null; busy: boolean; at: number }
/** Dekodiertes Bild: ImageBitmap (schnell) oder - als Rueckfall - ein <img>-Element. */
type Picture = ImageBitmap | HTMLImageElement;
const closePicture = (p: Picture | null | undefined): void => { if (p && 'close' in p) p.close(); };
const picSize = (p: Picture): { w: number; h: number } => ('naturalWidth' in p ? { w: p.naturalWidth, h: p.naturalHeight } : { w: p.width, h: p.height });

interface FrameEntry { bmp: Picture | null; ctrl: AbortController; failed?: boolean }
interface FrameRef { ts: number; len: number; codec: string }

export interface PlayerSnapshot {
  t: number;
  playing: boolean;
  speed: number;
  showBoxes: boolean;
  message: string;
  frameTs: number;
  fps: number | null;
  frameBytes: number;
  width: number | null;
  height: number | null;
  codec: string;
  span: number;
}

const MAX_INFLIGHT = 6;

const upperBound = (a: number[], v: number): number => {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (a[m] <= v) lo = m + 1; else hi = m;
  }
  return lo;
};

export class PlayerEngine {
  readonly cam: string;
  t: number;
  playing = true;
  speed = 1;
  showBoxes = true;
  span = 3_600_000;
  v0: number;
  rec: TimelineEntry[] = [];
  events: EventItem[] = [];

  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private idx = new Map<number, IndexEntry>();
  private frames = new Map<number, FrameEntry>();
  private dets = new Map<number, DetEntry>();
  private inflight = 0;
  private nextMin: { m: number; loading?: boolean; val?: number | null; at?: number } | null = null;
  private nat: { w: number; h: number } | null = null;
  private shownTs = 0;
  private shownBmp: Picture | null = null;
  private useImg = typeof createImageBitmap !== 'function';
  private shown: FrameRef | null = null;
  private stalled = false;
  /** Schnelle Wiedergabe kommt nicht hinterher: die Uhr wartet auf das naechste Bild. */
  private lagging = false;
  /** Geglaettete Zeit von der Anfrage bis zum dekodierten Bild (ms). */
  private latency = 150;
  private lastShownAt = 0;
  private dead = false;
  private raf = 0;
  private lastNow = performance.now();
  private lastNotify = 0;
  private lastRedraw = 0;
  private tlKey = '';
  private tlBusy = false;
  private message = '';
  private fps: number | null = null;
  private snapshot: PlayerSnapshot;
  private listeners = new Set<() => void>();
  private frameListeners = new Set<() => void>();

  constructor(cam: string, startTs: number, canvas: HTMLCanvasElement) {
    this.cam = cam;
    this.t = startTs || Date.now() - 60_000;
    this.v0 = this.t - this.span / 2;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.snapshot = this.makeSnapshot();
    this.raf = requestAnimationFrame(n => this.tick(n));
  }

  /* ----------------------------------------------------------- Anbindung */
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  };
  getSnapshot = (): PlayerSnapshot => this.snapshot;
  /** Wird nach jedem Durchlauf gerufen - die Zeitleiste zeichnet sich darin neu. */
  onFrame(fn: () => void): () => void {
    this.frameListeners.add(fn);
    return () => { this.frameListeners.delete(fn); };
  }

  private makeSnapshot(): PlayerSnapshot {
    return {
      t: this.t, playing: this.playing, speed: this.speed, showBoxes: this.showBoxes, message: this.message,
      frameTs: this.shownTs, fps: this.fps, frameBytes: this.shown?.len ?? 0,
      width: this.nat?.w ?? null, height: this.nat?.h ?? null, codec: this.shown?.codec ?? '', span: this.span,
    };
  }
  private notify(force = false): void {
    const now = performance.now();
    if (!force && now - this.lastNotify < 200) return;
    this.lastNotify = now;
    this.snapshot = this.makeSnapshot();
    this.listeners.forEach(fn => fn());
  }

  destroy(): void {
    this.dead = true;
    cancelAnimationFrame(this.raf);
    for (const f of this.frames.values()) { f.ctrl.abort(); closePicture(f.bmp); }
    this.frames.clear();
    this.listeners.clear();
    this.frameListeners.clear();
  }

  /* ------------------------------------------------------------ Steuerung */
  toggle(): void {
    this.playing = !this.playing;
    this.stalled = false;
    this.lagging = false;
    if (this.playing && this.shownTs && Math.abs(this.t - this.shownTs) < 3000) this.t = this.shownTs;
    this.notify(true);
  }
  seek(t: number, center = false): void {
    this.t = Math.min(t, Date.now());
    this.stalled = false;
    this.lagging = false;
    this.lastShownAt = performance.now();
    if (center || this.t < this.v0 || this.t > this.v0 + this.span) this.v0 = this.t - this.span / 2;
    this.notify(true);
  }
  step(dir: 1 | -1): void {
    this.playing = false;
    const base = this.shownTs || this.t;
    if (dir < 0) { const c = this.frameAt(base - 1); if (c) this.t = c.ts; }
    else { const n = this.nextAfter(base); if (n) this.t = n; }
    this.notify(true);
  }
  setSpeed(s: number): void { this.speed = s; this.lagging = false; this.lastShownAt = performance.now(); this.notify(true); }
  setShowBoxes(v: boolean): void { this.showBoxes = v; this.redraw(); this.notify(true); }
  setSpan(span: number): void { this.span = span; this.v0 = this.t - span / 2; this.notify(true); }
  zoomAt(center: number, factor: number): void {
    const ns = Math.min(2 * 86_400_000, Math.max(MIN, this.span * factor));
    this.v0 = center - ((center - this.v0) * ns) / this.span;
    this.span = ns;
    this.notify(true);
  }
  pan(deltaMs: number): void { this.v0 += deltaMs; }
  async jumpEvent(dir: 1 | -1): Promise<boolean> {
    const list = dir < 0
      ? await api.events.list({ camera: this.cam, end: Math.round(this.t - 4000), limit: 1 })
      : await api.events.list({ camera: this.cam, after: Math.round(this.t + 1000), order: 'asc', limit: 1 });
    if (!list.length) return false;
    this.seek(list[0].start_ts - 2000, true);
    this.playing = true;
    return true;
  }
  currentFrameTs(): number { return this.shownTs; }

  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const box = this.canvas.parentElement;
    if (!box) return;
    const w = Math.round(box.clientWidth * dpr);
    const h = Math.round(box.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      const grew = w > this.canvas.width * 1.2;
      this.canvas.width = w;
      this.canvas.height = h;
      if (grew) this.dropFrames();          // groessere Flaeche -> schaerfer neu dekodieren
      this.redraw();
    }
  }

  /* ---------------------------------------------------------------- Index */
  private ensureIdx(m: number): IndexEntry | null {
    let e = this.idx.get(m);
    const now = Date.now();
    if (!e) {
      e = { ts: null, len: null, codec: 'jpeg', busy: false, at: 0 };
      this.idx.set(m, e);
      if (this.idx.size > 300) for (const k of this.idx.keys()) if (Math.abs(k - m) > 60 * MIN) this.idx.delete(k);
    }
    const entry = e;
    const recent = m > now - 2 * MIN;       // laufende Minute waechst noch -> regelmaessig neu laden
    if ((entry.ts === null || (recent && now - entry.at > 1500)) && !entry.busy) {
      entry.busy = true;
      api.cameras.index(this.cam, m)
        .then(r => { entry.ts = r.ts; entry.len = r.len; entry.codec = r.codec; })
        .catch(() => { if (entry.ts === null) { entry.ts = []; entry.len = []; } })
        .finally(() => { entry.busy = false; entry.at = Date.now(); });
    }
    return entry.ts === null ? null : entry;
  }

  /** Letztes Bild mit ts <= t. undefined = wird noch geladen, null = keines vorhanden. */
  private frameAt(t: number): FrameRef | null | undefined {
    const m = Math.floor(t / MIN) * MIN;
    const e = this.ensureIdx(m);
    if (!e || !e.ts || !e.len) return undefined;
    const i = upperBound(e.ts, t) - 1;
    if (i >= 0) return { ts: e.ts[i], len: e.len[i], codec: e.codec };
    const p = this.ensureIdx(m - MIN);
    if (!p || !p.ts || !p.len) return undefined;
    // Video-Segmente enden nicht exakt an der Minutengrenze - passendes Bild in der Vorminute suchen
    const j = upperBound(p.ts, t) - 1;
    if (j >= 0) return { ts: p.ts[j], len: p.len[j], codec: p.codec };
    return null;
  }

  private nextMinute(m: number): number | null | undefined {
    const c = this.nextMin;
    if (c && c.m === m && (c.loading || c.val !== null || Date.now() - (c.at ?? 0) < 4000)) return c.loading ? undefined : c.val;
    const mine: NonNullable<PlayerEngine['nextMin']> = { m, loading: true };
    this.nextMin = mine;
    api.cameras.timeline(this.cam, m + MIN, m + MIN + 7 * 86_400_000)
      .then(r => { if (this.nextMin === mine) this.nextMin = { m, val: r.length ? r[0][0] : null, at: Date.now() }; })
      .catch(() => { if (this.nextMin === mine) this.nextMin = { m, val: null, at: Date.now() }; });
    return undefined;
  }

  /** Zeitstempel des naechsten Bildes nach t. */
  private nextAfter(t: number): number | null | undefined {
    const m = Math.floor(t / MIN) * MIN;
    const e = this.ensureIdx(m);
    if (!e || !e.ts) return undefined;
    const i = upperBound(e.ts, t);
    if (i < e.ts.length) return e.ts[i];
    const nm = this.nextMinute(m);
    if (nm == null) return nm;
    const e2 = this.ensureIdx(nm);
    if (!e2 || !e2.ts) return undefined;
    return e2.ts.length ? e2.ts[0] : null;
  }

  /* --------------------------------------------------------------- Bilder */
  private request(ts: number): void {
    if (this.frames.has(ts)) return;
    const f: FrameEntry = { bmp: null, ctrl: new AbortController() };
    this.frames.set(ts, f);
    this.inflight++;
    const t0 = performance.now();
    fetch(api.cameras.frameUrl(this.cam, ts), { signal: f.ctrl.signal, credentials: 'same-origin' })
      .then(r => { if (!r.ok) throw new Error('http'); return r.blob(); })
      .then(blob => this.decode(blob))
      .then(bmp => {
        this.latency = Math.min(5000, this.latency * 0.7 + (performance.now() - t0) * 0.3);
        if (this.frames.get(ts) === f) f.bmp = bmp; else closePicture(bmp);
      })
      .catch(() => { if (this.frames.get(ts) === f) f.failed = true; })
      .finally(() => { this.inflight--; });
  }

  /** Rueckfall ohne createImageBitmap: ueber ein <img>-Element dekodieren. */
  private async decodeImg(blob: Blob): Promise<HTMLImageElement> {
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /**
   * Auf Anzeigegroesse dekodieren: spart Speicher und Rechenzeit, das Original bleibt auf dem Server.
   * Antwortet createImageBitmap nicht (kommt bei Software-Grafik ohne GPU vor), wird dauerhaft auf
   * die <img>-Dekodierung umgeschaltet.
   */
  private async decode(blob: Blob): Promise<Picture> {
    if (this.useImg) {
      const img = await this.decodeImg(blob);
      if (!this.nat) this.nat = picSize(img);
      return img;
    }
    let opts: ImageBitmapOptions | undefined;
    if (this.nat) {
      const s = Math.min(this.canvas.width / this.nat.w, this.canvas.height / this.nat.h);
      const w = Math.round(this.nat.w * s);
      if (s < 0.8 && w > 16) opts = { resizeWidth: w, resizeHeight: Math.round(this.nat.h * s), resizeQuality: 'medium' };
    }
    const pending = (opts ? createImageBitmap(blob, opts).catch(() => createImageBitmap(blob)) : createImageBitmap(blob));
    const timeout = new Promise<null>(resolve => window.setTimeout(() => resolve(null), 1500));
    const bmp = await Promise.race([pending, timeout]);
    if (bmp === null) {
      this.useImg = true;
      pending.then(b => b.close()).catch(() => { /* egal */ });
      return this.decode(blob);
    }
    if (!this.nat) this.nat = { w: bmp.width, h: bmp.height };
    return bmp;
  }

  private dropFrames(): void {
    for (const [ts, f] of this.frames) {
      if (f.bmp && f.bmp === this.shownBmp) continue;
      f.ctrl.abort();
      closePicture(f.bmp);
      this.frames.delete(ts);
    }
  }

  private prefetch(cur: FrameRef | null): void {
    const fast = this.playing && this.speed > 2;
    const horizon = 1500 * Math.max(1, this.speed);
    // Schnell: hoechstens so viele Bilder pro Sekunde anfordern, wie nachweislich ankommen
    // (6 Verbindungen, gemessene Ladezeit), und nie mehr als 15 - der Rest waere verschwendet.
    const rate = Math.max(1, Math.min(15, (0.8 * MAX_INFLIGHT * 1000) / this.latency));
    const minGap = fast ? Math.max(this.speed * 33, (this.speed * 1000) / rate) : 0;
    // Vorlauf: Bilder, die beim Eintreffen schon ueberholt waeren, gar nicht erst laden.
    const lead = fast && !this.lagging ? this.speed * this.latency * 1.2 : 0;
    const want: number[] = [];
    let ts: number | null = cur ? cur.ts : null;
    // Schnell: festes Raster (erstes Bild je Abschnitt von minGap) - so waehlt jeder Durchlauf
    // dieselben Bilder und nicht bei jedem Tick ein neues.
    let lastSlot = -1;
    let guard = 0;
    if (cur && (!fast || this.lagging || !this.shownTs)) want.push(cur.ts);
    while (this.playing && ts != null && want.length < 24 && guard++ < 3000) {
      const n = this.nextAfter(ts);
      if (!n || n > this.t + lead + horizon) break;
      const slot = minGap ? Math.floor(n / minGap) : -2;
      if ((!minGap || slot !== lastSlot) && n >= this.t + lead) want.push(n);
      lastSlot = slot;
      ts = n;
    }
    for (const w of want) { if (this.inflight >= MAX_INFLIGHT) break; this.request(w); }
    const keep = new Set(want);
    // Schnell: auch ueberholte Bilder behalten, bis ein neueres gezeigt wurde - sie sind immer
    // noch aktueller als das, was gerade zu sehen ist. Laufende Anfragen nicht abbrechen.
    const back = fast ? Math.max(400, this.speed * (this.latency * 2 + 600)) : 400;
    for (const [k, f] of this.frames) {
      if (keep.has(k) || (f.bmp && f.bmp === this.shownBmp)) continue;
      const stale = fast ? k < this.shownTs || k < this.t - back : k < this.t - back;
      if (stale || k > this.t + lead + horizon * 2 || f.failed) {
        if (!f.bmp) f.ctrl.abort();
        closePicture(f.bmp);
        this.frames.delete(k);
      }
    }
  }

  /* ---------------------------------------------------------- Erkennungen */
  private ensureDets(m: number): DetEntry | null {
    let e = this.dets.get(m);
    const now = Date.now();
    if (!e) {
      e = { groups: null, busy: false, at: 0 };
      this.dets.set(m, e);
      if (this.dets.size > 300) for (const k of this.dets.keys()) if (Math.abs(k - m) > 60 * MIN) this.dets.delete(k);
    }
    const entry = e;
    const recent = m > now - 3 * MIN && m <= now;
    if ((entry.groups === null || (recent && now - entry.at > 4000)) && !entry.busy) {
      entry.busy = true;
      api.cameras.detections(this.cam, m, m + MIN)
        .then(rows => {
          const groups: DetGroup[] = [];
          for (const r of rows) {
            if (!groups.length || groups[groups.length - 1].ts !== r[0]) groups.push({ ts: r[0], d: [] });
            groups[groups.length - 1].d.push(r);
          }
          entry.groups = groups;
        })
        .catch(() => { if (entry.groups === null) entry.groups = []; })
        .finally(() => { entry.busy = false; entry.at = Date.now(); });
    }
    return entry.groups === null ? null : entry;
  }

  /** Boxen zum Zeitpunkt ts; zwischen zwei Analysen wird interpoliert, damit die Box dem Objekt folgt. */
  private detsAt(ts: number): DrawBox[] {
    const m = Math.floor(ts / MIN) * MIN;
    const gs: DetGroup[] = [];
    for (const k of [m - MIN, m, m + MIN]) { const e = this.ensureDets(k); if (e?.groups) gs.push(...e.groups); }
    let i = -1;
    for (let k = 0; k < gs.length; k++) { if (gs[k].ts <= ts + 40) i = k; else break; }
    if (i < 0) return [];
    const g = gs[i];
    const n = gs[i + 1];
    const out: DrawBox[] = [];
    for (const d of g.d) {
      const age = ts - g.ts;
      const nd = n && n.ts - g.ts <= 4500 ? n.d.find(x => x[7] === d[7] && x[1] === d[1]) : undefined;
      if (nd) {
        const f = Math.min(1, Math.max(0, age / (n.ts - g.ts)));
        out.push([d[1], d[2], d[3] + (nd[3] - d[3]) * f, d[4] + (nd[4] - d[4]) * f, d[5] + (nd[5] - d[5]) * f, d[6] + (nd[6] - d[6]) * f]);
      } else if (age <= 700) {
        out.push([d[1], d[2], d[3], d[4], d[5], d[6]]);
      }
    }
    return out;
  }

  /* ------------------------------------------------------------- Zeichnen */
  private show(bmp: Picture, cur: FrameRef): void {
    const prev = this.shownTs;
    this.shownBmp = bmp;
    this.lastShownAt = performance.now();
    this.shownTs = cur.ts;
    this.shown = cur;
    this.redraw();
    const n = this.nextAfter(cur.ts);
    const gap = n ? n - cur.ts : prev && cur.ts > prev ? cur.ts - prev : 0;
    this.fps = gap > 0 && gap < 5000 ? 1000 / gap : null;
  }

  redraw(): void {
    const { ctx, canvas } = this;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const bmp = this.shownBmp;
    if (!bmp) return;
    const size = picSize(bmp);
    const r = fitRect(canvas.width, canvas.height, size.w, size.h);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, r.x, r.y, r.w, r.h);
    if (this.showBoxes) {
      const d = this.detsAt(this.shownTs);
      if (d.length) drawBoxes(ctx, d, r, window.devicePixelRatio || 1);
    }
  }

  private tick(now: number): void {
    if (this.dead) return;
    const dt = Math.min(250, now - this.lastNow);
    this.lastNow = now;
    if (this.playing && !this.stalled && !this.lagging) this.t += dt * this.speed;
    if (this.t > Date.now()) this.t = Date.now();
    let msg = '';
    let cur = this.frameAt(this.t);
    if (cur === undefined) {
      this.stalled = this.playing;
    } else {
      this.stalled = false;
      if (this.playing && (cur === null || this.t - cur.ts > 3000)) {
        // Luecke in der Aufnahme: zum naechsten vorhandenen Bild springen
        const n = this.nextAfter(this.t);
        if (n === undefined) this.stalled = true;
        else if (n === null) {
          if (Date.now() - this.t < 2 * MIN) {
            if (cur) this.t = Math.min(this.t, cur.ts + 2999);
            msg = cur ? '' : 'waiting';
          } else { this.playing = false; msg = 'end'; }
        } else if (n - this.t > 0) {
          this.t = n;
          cur = this.frameAt(n);
          if (cur === undefined) this.stalled = true;
        }
      } else if (this.playing && cur && Date.now() - this.t < 2 * MIN && this.nextAfter(cur.ts) === null) {
        this.t = Math.min(this.t, cur.ts + 1);      // am Live-Rand nicht ueber das neueste Bild hinauslaufen
      }
      if (cur === null && !this.playing) msg = 'none';
      if (cur && cur.ts !== this.shownTs) {
        const f = this.frames.get(cur.ts);
        if (f?.bmp) this.show(f.bmp, cur);
        else {
          let best: FrameEntry | null = null;
          let bts = this.shownTs < cur.ts ? this.shownTs : -1;
          if (this.playing && this.speed > 2) {
            for (const [k, v] of this.frames) if (v.bmp && k > bts && k <= cur.ts) { best = v; bts = k; }
          }
          if (best?.bmp) this.show(best.bmp, { ts: bts, len: 0, codec: cur.codec });
          else if (this.playing && this.speed <= 2 && !f?.failed) { this.stalled = true; this.t = cur.ts; }
          if (f?.failed && !this.playing) msg = 'gone';
          else if (!best && cur.codec === 'video' && Math.abs(cur.ts - this.shownTs) > 5000) msg = 'decoding';
          else if (!best && !this.shownTs) msg = 'loading';
        }
      }
    }
    // Schnelle Wiedergabe: laenger als eine Sekunde kein neues Bild, obwohl eines faellig ist ->
    // die Uhr anhalten, bis das Laden aufgeholt hat (sonst liefe sie den Bildern davon).
    this.lagging = this.playing && this.speed > 2 && !!cur && cur.ts !== this.shownTs
      && now - this.lastShownAt > 1000 && Math.abs(this.t - this.shownTs) > this.speed * 500;
    if (cur !== undefined) this.prefetch(cur);
    if (this.showBoxes && this.shownTs && !this.playing && now - this.lastRedraw > 500) {
      this.lastRedraw = now;                 // Boxen koennen nach dem Bild eintreffen
      this.redraw();
    }
    if (this.playing && (this.t < this.v0 || this.t > this.v0 + this.span)) this.v0 = this.t - this.span * 0.1;
    if (msg !== this.message) { this.message = msg; this.notify(true); }
    this.loadTimeline(now);
    this.notify();
    this.frameListeners.forEach(fn => fn());
    this.raf = requestAnimationFrame(n => this.tick(n));
  }

  /* ----------------------------------------------- Daten fuer die Zeitleiste */
  private lastTl = 0;
  private loadTimeline(now: number): void {
    if (now - this.lastTl < 500 || this.tlBusy) return;
    this.lastTl = now;
    const q = Math.max(MIN, this.span / 4);
    const a = Math.floor((this.v0 - this.span / 2) / q) * q;
    const b = Math.ceil((this.v0 + this.span * 1.5) / q) * q;
    const key = `${a}:${b}:${Math.floor(Date.now() / 10_000)}`;
    if (key === this.tlKey) return;
    this.tlKey = key;
    this.tlBusy = true;
    Promise.all([api.cameras.timeline(this.cam, a, b), api.events.list({ camera: this.cam, start: a, end: b, limit: 1000 })])
      .then(([rec, ev]) => { this.rec = rec; this.events = ev; })
      .catch(() => { /* naechster Versuch folgt */ })
      .finally(() => { this.tlBusy = false; });
  }
}
