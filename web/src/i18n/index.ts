import { useSyncExternalStore } from 'react';
import { de } from './de';
import { en, type Key } from './en';

/**
 * Mehrsprachigkeit ohne Bibliothek.
 *
 * Eine Sprache hinzufügen:
 *   1. en.ts nach <code>.ts kopieren (z. B. fr.ts) und die Texte übersetzen; als Typ
 *      `Record<Key, string>` angeben, dann meldet TypeScript fehlende Schlüssel.
 *   2. Die Datei unten in CATALOGS und LANGUAGES eintragen.
 * Fehlt ein Schlüssel zur Laufzeit trotzdem, wird der englische Text gezeigt.
 */
export type { Key };

const CATALOGS = { de, en } satisfies Record<string, Record<Key, string>>;
export type Lang = keyof typeof CATALOGS;
export type LangSetting = Lang | 'auto';

export const LANGUAGES: { code: Lang; name: string; locale: string }[] = [
  { code: 'de', name: 'Deutsch', locale: 'de-CH' },
  { code: 'en', name: 'English', locale: 'en-GB' },
];

type Params = Record<string, string | number>;

let current: Lang = 'en';
const listeners = new Set<() => void>();

/** Sprache des Browsers, falls unterstützt – sonst Englisch. */
export function detectLanguage(): Lang {
  for (const tag of navigator.languages ?? [navigator.language]) {
    const code = tag.toLowerCase().split('-')[0];
    if (code in CATALOGS) return code as Lang;
  }
  return 'en';
}

export function setLanguage(lang: Lang): void {
  if (lang === current) return;
  current = lang;
  // Abonnenten erst nach dem laufenden Rendern benachrichtigen.
  queueMicrotask(() => listeners.forEach(fn => fn()));
}

export const language = (): Lang => current;
export const locale = (): string => LANGUAGES.find(l => l.code === current)?.locale ?? 'en-GB';

const fill = (text: string, params?: Params): string =>
  params ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m)) : text;

/** Übersetzt einen Schlüssel. Auch außerhalb von React nutzbar (Canvas, Formatierer). */
export function t(key: Key, params?: Params): string {
  return fill(CATALOGS[current][key] ?? en[key] ?? key, params);
}

/** Für Schlüssel, die erst zur Laufzeit feststehen (Fehlercodes, Objektnamen, Zustände). */
export function tMaybe(key: string, fallback: string, params?: Params): string {
  const cat = CATALOGS[current] as Record<string, string>;
  const text = cat[key] ?? (en as Record<string, string>)[key];
  return text === undefined ? fallback : fill(text, params);
}

const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

/** Hook: liefert t() und sorgt dafür, dass die Komponente bei Sprachwechsel neu zeichnet. */
export function useI18n(): { t: typeof t; tMaybe: typeof tMaybe; lang: Lang } {
  const lang = useSyncExternalStore(subscribe, language);
  return { t, tMaybe, lang };
}
