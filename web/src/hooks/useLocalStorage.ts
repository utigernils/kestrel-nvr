import { useCallback, useState } from 'react';

/** Kleine, fehlertolerante Ablage fuer Komfort-Einstellungen im Browser. */
export function useLocalStorage<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = window.localStorage.getItem(key);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });
  const set = useCallback((v: T) => {
    setValue(v);
    try { window.localStorage.setItem(key, JSON.stringify(v)); } catch { /* Speicher nicht verfuegbar */ }
  }, [key]);
  return [value, set];
}
