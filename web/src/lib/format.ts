import { locale, t } from '../i18n';

export const MIN = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;

const p2 = (n: number): string => String(n).padStart(2, '0');

export function fmtTime(ts: number, ms = false): string {
  const d = new Date(ts);
  let s = `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
  if (ms) s += `.${String(d.getMilliseconds()).padStart(3, '0')}`;
  return s;
}

export function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString(locale(), { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** JJJJ-MM-TT in Ortszeit (Format der <input type="date">). */
export function isoDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

export function dayStart(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function fmtDayLabel(ts: number): string {
  const today = dayStart(Date.now());
  const day = dayStart(ts);
  if (day === today) return t('day.today');
  if (day === today - DAY) return t('day.yesterday');
  return new Date(ts).toLocaleDateString(locale(), { weekday: 'long', day: '2-digit', month: 'long' });
}

export function fmtNumber(n: number): string {
  return n.toLocaleString(locale());
}

export function fmtBytes(b: number | null | undefined): string {
  if (b == null || !isFinite(b)) return '–';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = b;
  while (v >= 1000 && i < u.length - 1) { v /= 1000; i++; }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${u[i]}`;
}

export function fmtDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return t('dur.s', { s });
  if (s < 3600) return t('dur.min', { m: Math.floor(s / 60), s: s % 60 });
  if (s < 86400) return t('dur.h', { h: Math.floor(s / 3600), m: Math.floor((s % 3600) / 60) });
  return t('dur.d', { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600) });
}

export function fmtCapacity(days: number | null): string {
  if (days == null) return t('common.measuring');
  if (days >= 2) return t('cap.days', { n: days.toFixed(1) });
  return t('cap.hours', { n: (days * 24).toFixed(0) });
}

export function relativeTime(ts: number): string {
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return t('rel.now');
  if (s < 3600) return t('rel.min', { n: Math.floor(s / 60) });
  if (s < 86400) return t('rel.h', { n: Math.floor(s / 3600) });
  return t('rel.d', { n: Math.floor(s / 86400) });
}
