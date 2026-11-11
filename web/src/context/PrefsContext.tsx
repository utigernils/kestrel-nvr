import { createContext, useContext, useLayoutEffect, useMemo, type ReactNode } from 'react';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { detectLanguage, LANGUAGES, setLanguage, type Lang, type LangSetting } from '../i18n';
import { applyTheme, getPalette, type Mode, type ModeSetting, type Palette, type ThemeName } from '../lib/theme';

interface Prefs {
  theme: ThemeName;
  setTheme: (t: ThemeName) => void;
  /** Einstellung des Benutzers: hell, dunkel oder dem Betriebssystem folgen */
  modeSetting: ModeSetting;
  setModeSetting: (m: ModeSetting) => void;
  /** Tatsaechlich aktiver Modus */
  mode: Mode;
  palette: Palette;
  /** Sprache: fest gewaehlt oder 'auto' (Browser) */
  langSetting: LangSetting;
  setLangSetting: (l: LangSetting) => void;
  lang: Lang;
  /** Kleine Bewegungen (Zaehler, Seitenwechsel) erlaubt - aus bei "Bewegung reduzieren" */
  motion: boolean;
  /** Tempo des Farbverlaufs im Kestrel-Theme in Prozent, 0 = steht still */
  auroraSpeed: number;
  setAuroraSpeed: (v: number) => void;
  showBoxes: boolean;
  setShowBoxes: (v: boolean) => void;
}

const PrefsContext = createContext<Prefs | null>(null);

export function PrefsProvider({ children }: { children: ReactNode }) {
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const systemLight = useMediaQuery('(prefers-color-scheme: light)');
  const [theme, setTheme] = useLocalStorage<ThemeName>('kestrel.theme', 'kestrel');
  const [modeSetting, setModeSetting] = useLocalStorage<ModeSetting>('kestrel.mode', 'dark');
  const [langSetting, setLangSetting] = useLocalStorage<LangSetting>('kestrel.lang', 'auto');
  const [speed, setSpeed] = useLocalStorage('kestrel.auroraSpeed', 100);
  const [showBoxes, setShowBoxes] = useLocalStorage('kestrel.boxes', true);

  const safeTheme: ThemeName = theme === 'levin' ? 'levin' : 'kestrel';
  const mode: Mode = modeSetting === 'auto' ? (systemLight ? 'light' : 'dark') : modeSetting === 'light' ? 'light' : 'dark';
  const lang: Lang = LANGUAGES.some(l => l.code === langSetting) ? (langSetting as Lang) : detectLanguage();
  const auroraSpeed = Number.isFinite(speed) ? Math.max(0, Math.min(200, Number(speed))) : 100;

  // Schon beim Rendern setzen, damit die Kinder sofort in der richtigen Sprache zeichnen.
  setLanguage(lang);
  // Vor dem ersten Zeichnen anwenden, damit nichts in falschen Farben aufblitzt.
  useLayoutEffect(() => { applyTheme(safeTheme, mode); }, [safeTheme, mode]);
  useLayoutEffect(() => { document.documentElement.lang = lang; }, [lang]);

  const value = useMemo<Prefs>(() => ({
    theme: safeTheme, setTheme, modeSetting, setModeSetting, mode, palette: getPalette(safeTheme, mode),
    langSetting, setLangSetting, lang, motion: !reduced, auroraSpeed, setAuroraSpeed: setSpeed, showBoxes, setShowBoxes,
  }), [safeTheme, setTheme, modeSetting, setModeSetting, mode, langSetting, setLangSetting, lang, reduced, auroraSpeed, setSpeed, showBoxes, setShowBoxes]);
  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}

export function usePrefs(): Prefs {
  const ctx = useContext(PrefsContext);
  if (!ctx) throw new Error('usePrefs outside PrefsProvider');
  return ctx;
}
