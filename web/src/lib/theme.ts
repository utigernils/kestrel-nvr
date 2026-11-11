/**
 * Themes. Jede Kombination aus Theme und Modus ist eine Palette; sie ist die einzige Quelle
 * fuer Farben - sie wird als CSS-Variablen gesetzt und von den Canvas-Zeichnern gelesen.
 */
export type ThemeName = 'kestrel' | 'levin';
export type Mode = 'dark' | 'light';
export type ModeSetting = Mode | 'auto';

export interface Palette {
  bg: string;
  surface: string;      // Karten, Hinweise - immer deckend
  surface2: string;     // Eingabefelder, Hover
  surface3: string;     // gedrueckt / aktiv
  line: string;
  lineStrong: string;
  text: string;
  mute: string;
  accent: string;       // Fokus, aktive Elemente, Abspielposition
  accentSoft: string;
  primaryBg: string;    // Hauptknopf
  primaryFg: string;
  ok: string;
  warn: string;
  bad: string;
  warnBg: string;
  warnLine: string;
  warnText: string;
  navBg: string;
  navText: string;
  navActiveBg: string;
  navActiveText: string;
  barA: string;         // Aufnahme-Balken in der Zeitleiste (Verlauf A -> B)
  barB: string;
  meterA: string;
  meterB: string;
  radius: string;
  radiusSm: string;
  shadow: string;
}

export interface ThemeInfo {
  name: ThemeName;
  label: string;
}

/** Die Beschreibung steht in den Sprachdateien (app2.theme.<name>). */
export const THEMES: ThemeInfo[] = [
  { name: 'kestrel', label: 'Kestrel' },
  { name: 'levin', label: 'Levin' },
];

const PALETTES: Record<ThemeName, Record<Mode, Palette>> = {
  kestrel: {
    dark: {
      bg: '#050507', surface: '#0e1016', surface2: '#171a22', surface3: '#222632', line: '#252935', lineStrong: '#3a4050',
      text: '#ffffff', mute: '#9aa1af', accent: '#ffffff', accentSoft: '#1d212b', primaryBg: '#ffffff', primaryFg: '#050507',
      ok: '#34d399', warn: '#fbbf24', bad: '#fb7185', warnBg: '#1f1a0c', warnLine: '#5c4a14', warnText: '#fde9b0',
      navBg: '#0e1016', navText: '#9aa1af', navActiveBg: '#222632', navActiveText: '#ffffff',
      barA: '#22d3ee', barB: '#a78bfa', meterA: '#22d3ee', meterB: '#a78bfa',
      radius: '18px', radiusSm: '12px', shadow: '0 18px 50px -24px rgba(0,0,0,0.9)',
    },
    light: {
      bg: '#f3f4f7', surface: '#ffffff', surface2: '#f1f2f5', surface3: '#e4e6eb', line: '#dfe2e8', lineStrong: '#c3c8d2',
      text: '#0a0b0f', mute: '#5d6472', accent: '#0a0b0f', accentSoft: '#eceef2', primaryBg: '#0a0b0f', primaryFg: '#ffffff',
      ok: '#059669', warn: '#b45309', bad: '#e11d48', warnBg: '#fff7e0', warnLine: '#f0d58a', warnText: '#6b4a05',
      navBg: '#ffffff', navText: '#5d6472', navActiveBg: '#e4e6eb', navActiveText: '#0a0b0f',
      barA: '#0891b2', barB: '#7c3aed', meterA: '#0891b2', meterB: '#7c3aed',
      radius: '18px', radiusSm: '12px', shadow: '0 14px 40px -24px rgba(15,23,42,0.35)',
    },
  },
  levin: {
    dark: {
      bg: '#0d1014', surface: '#14181e', surface2: '#1a1f27', surface3: '#232a34', line: '#232933', lineStrong: '#343c49',
      text: '#e7e9ed', mute: '#8891a0', accent: '#5b8def', accentSoft: '#172236', primaryBg: '#3565c8', primaryFg: '#ffffff',
      ok: '#3fb37f', warn: '#d49a2a', bad: '#e0596b', warnBg: '#1e1a10', warnLine: '#4a3d16', warnText: '#ecd9a6',
      navBg: '#0a0c10', navText: '#8891a0', navActiveBg: '#172236', navActiveText: '#e7e9ed',
      barA: '#3565c8', barB: '#3565c8', meterA: '#3565c8', meterB: '#3565c8',
      radius: '8px', radiusSm: '6px', shadow: 'none',
    },
    light: {
      bg: '#f2f3f5', surface: '#ffffff', surface2: '#f4f5f7', surface3: '#e6e9ee', line: '#e0e3e8', lineStrong: '#c6cbd3',
      text: '#14171c', mute: '#5f6775', accent: '#1f4fbf', accentSoft: '#e6edfb', primaryBg: '#1c3f94', primaryFg: '#ffffff',
      ok: '#1f8a5b', warn: '#a66a00', bad: '#c2334a', warnBg: '#fdf5df', warnLine: '#ecd592', warnText: '#5e4300',
      navBg: '#141922', navText: '#9aa3b2', navActiveBg: '#243049', navActiveText: '#ffffff',
      barA: '#1f4fbf', barB: '#1f4fbf', meterA: '#1f4fbf', meterB: '#1f4fbf',
      radius: '8px', radiusSm: '6px', shadow: '0 1px 2px rgba(16,24,40,0.06)',
    },
  },
};

const kebab = (s: string): string => s.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`);

let current: Palette = PALETTES.kestrel.dark;
let currentMode: Mode = 'dark';

/** Palette, die gerade gilt (fuer Canvas-Zeichner ausserhalb von React). */
export const palette = (): Palette => current;
export const activeMode = (): Mode => currentMode;

export function getPalette(theme: ThemeName, mode: Mode): Palette {
  return PALETTES[theme]?.[mode] ?? PALETTES.kestrel.dark;
}

/** Setzt Palette und Kennzeichen am <html>-Element. */
export function applyTheme(theme: ThemeName, mode: Mode): void {
  current = getPalette(theme, mode);
  currentMode = mode;
  const root = document.documentElement;
  for (const [k, v] of Object.entries(current)) root.style.setProperty(`--${kebab(k)}`, v);
  root.dataset.theme = theme;
  root.dataset.mode = mode;
  root.style.colorScheme = mode;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', current.bg);
}
