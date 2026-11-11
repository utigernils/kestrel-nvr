import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import { usePrefs } from '../../context/PrefsContext';

interface PageTransitionProps {
  /** Wechselt der Schluessel, wird der neue Inhalt eingeblendet. */
  id: string;
  children: ReactNode;
}

/**
 * Dezenter Seitenwechsel. Nur der neue Inhalt wird eingeblendet; der alte wird sofort entfernt,
 * damit Live-Stroeme und Player ohne Verzoegerung schliessen und nichts doppelt im Layout steht.
 * Kestrel: Einblenden mit 6 px Versatz (180 ms). Levin: reines Einblenden (120 ms).
 * Bei "Bewegung reduzieren" im Betriebssystem: kein Uebergang.
 */
export function PageTransition({ id, children }: PageTransitionProps) {
  const { theme, motion: allowed } = usePrefs();
  if (!allowed) return <div key={id}>{children}</div>;
  const levin = theme === 'levin';
  return (
    <motion.div key={id} initial={{ opacity: 0, y: levin ? 0 : 6 }} animate={{ opacity: 1, y: 0 }}
                transition={{ duration: levin ? 0.12 : 0.18, ease: 'easeOut' }}
                // Nach dem Einblenden keinen transform stehen lassen (Vollbild, position: fixed).
                onAnimationComplete={() => { /* motion setzt transform: none */ }}>
      {children}
    </motion.div>
  );
}
