import { labelColor } from '../labels';
import { fmtTime, MIN } from '../format';
import { palette } from '../theme';
import type { PlayerEngine } from './PlayerEngine';

const STEPS = [60_000, 300_000, 600_000, 1_800_000, 3_600_000, 7_200_000, 21_600_000, 43_200_000];
const p2 = (n: number): string => String(n).padStart(2, '0');

/** Zeichnet Aufnahme-Balken, Ereignisse, Skala und Abspielposition. */
export function drawTimeline(cv: HTMLCanvasElement, engine: PlayerEngine, hoverX: number | null): void {
  const ctx = cv.getContext('2d');
  if (!ctx || !cv.width) return;
  const W = cv.width;
  const H = cv.height;
  const dpr = window.devicePixelRatio || 1;
  const p = palette();
  const { v0, span } = engine;
  const X = (t: number): number => ((t - v0) / span) * W;

  ctx.clearRect(0, 0, W, H);

  // aufgezeichnete Minuten
  const y0 = H * 0.5;
  const bh = H * 0.26;
  const grad = ctx.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, p.barA);
  grad.addColorStop(1, p.barB);
  ctx.fillStyle = grad;
  const mw = Math.max(1, (MIN / span) * W);
  for (const r of engine.rec) {
    const x = X(r[0]);
    if (x > W || x + mw < 0) continue;
    ctx.fillRect(x, y0, mw + 0.5, bh);
  }

  // Ereignisse
  for (const e of engine.events) {
    const x = X(e.start_ts);
    const w = Math.max(3 * dpr, X(e.end_ts) - x);
    if (x > W || x + w < 0) continue;
    ctx.fillStyle = labelColor(e.label);
    ctx.beginPath();
    ctx.roundRect(x, H * 0.26, w, H * 0.16, 2 * dpr);
    ctx.fill();
  }

  // Skala
  let step = STEPS[STEPS.length - 1];
  for (const s of STEPS) if ((s / span) * W >= 72 * dpr) { step = s; break; }
  const tz = new Date(v0).getTimezoneOffset() * 60_000;
  ctx.fillStyle = p.mute;
  ctx.strokeStyle = p.lineStrong;
  ctx.lineWidth = dpr;
  ctx.font = `${11 * dpr}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textBaseline = 'alphabetic';
  for (let t = Math.ceil((v0 - tz) / step) * step + tz; t < v0 + span; t += step) {
    const x = Math.round(X(t)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, H * 0.8);
    ctx.lineTo(x, H);
    ctx.stroke();
    const d = new Date(t);
    const lab = d.getHours() === 0 && d.getMinutes() === 0 ? `${p2(d.getDate())}.${p2(d.getMonth() + 1)}.` : `${p2(d.getHours())}:${p2(d.getMinutes())}`;
    ctx.fillText(lab, x + 4 * dpr, H - 5 * dpr);
  }

  // Zukunft abdunkeln
  const xn = X(Date.now());
  if (xn < W) {
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = p.bg;
    ctx.fillRect(Math.max(0, xn), 0, W, H);
    ctx.globalAlpha = 1;
  }

  // Mauszeiger
  if (hoverX !== null) {
    const hx = hoverX * dpr;
    ctx.strokeStyle = p.mute;
    ctx.setLineDash([3 * dpr, 3 * dpr]);
    ctx.beginPath();
    ctx.moveTo(hx, 0);
    ctx.lineTo(hx, H);
    ctx.stroke();
    ctx.setLineDash([]);
    const lab = fmtTime(v0 + (hx / W) * span);
    const lw = ctx.measureText(lab).width + 10 * dpr;
    const lx = Math.min(W - lw, Math.max(0, hx - lw / 2));
    ctx.fillStyle = p.surface3;
    ctx.fillRect(lx, H - 17 * dpr, lw, 17 * dpr);
    ctx.fillStyle = p.text;
    ctx.fillText(lab, lx + 5 * dpr, H - 5 * dpr);
  }

  // Abspielposition
  const xp = Math.round(X(engine.t)) + 0.5;
  ctx.strokeStyle = p.text;
  ctx.lineWidth = 2 * dpr;
  ctx.beginPath();
  ctx.moveTo(xp, 0);
  ctx.lineTo(xp, H);
  ctx.stroke();
  const lab = fmtTime(engine.t);
  const lw = ctx.measureText(lab).width + 12 * dpr;
  const lx = Math.min(W - lw, Math.max(0, xp - lw / 2));
  ctx.fillStyle = p.text;
  ctx.beginPath();
  ctx.roundRect(lx, 0, lw, 16 * dpr, 4 * dpr);
  ctx.fill();
  ctx.fillStyle = p.bg;
  ctx.fillText(lab, lx + 6 * dpr, 12 * dpr);
}
