import { useSyncExternalStore } from 'react';

/**
 * "Zum Startbildschirm hinzufuegen". Chrome meldet per `beforeinstallprompt`, dass die Seite
 * installierbar ist - aber nur in sicherem Kontext (HTTPS oder localhost). In allen anderen
 * Faellen zeigt die Oberflaeche eine passende Anleitung statt eines toten Knopfs.
 */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type InstallState = 'available' | 'installed' | 'ios' | 'insecure' | 'manual';

let deferred: InstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(fn => fn());

const standalone = (): boolean =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
const isIos = (): boolean =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function compute(): InstallState {
  if (installed || standalone()) return 'installed';
  if (deferred) return 'available';
  if (isIos()) return 'ios';
  if (!window.isSecureContext) return 'insecure';
  return 'manual';
}

let state: InstallState = 'manual';
const update = () => { const next = compute(); if (next !== state) { state = next; emit(); } };

/** Einmal beim Start aufrufen - das Ereignis kommt frueh und nur einmal. */
export function initInstall(): void {
  state = compute();
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e as InstallPromptEvent; update(); });
  window.addEventListener('appinstalled', () => { installed = true; deferred = null; update(); });
  window.matchMedia('(display-mode: standalone)').addEventListener('change', update);
}

/** Zeigt den Installationsdialog des Browsers. Liefert true, wenn installiert wurde. */
export async function promptInstall(): Promise<boolean> {
  const ev = deferred;
  if (!ev) return false;
  await ev.prompt();
  const { outcome } = await ev.userChoice;
  deferred = null;
  if (outcome === 'accepted') installed = true;
  update();
  return outcome === 'accepted';
}

const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export const useInstallState = (): InstallState => useSyncExternalStore(subscribe, () => state);

/** Service Worker anmelden (nur in sicherem Kontext moeglich). Er puffert nur die App-Huelle. */
export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator) || !window.isSecureContext || import.meta.env.DEV) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* ohne SW laeuft alles wie bisher */ });
  });
}
