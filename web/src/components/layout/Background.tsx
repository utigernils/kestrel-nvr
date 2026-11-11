import { lazy, Suspense } from 'react';
import { usePrefs } from '../../context/PrefsContext';
import { useMediaQuery } from '../../hooks/useMediaQuery';

const Aurora = lazy(() => import('../reactbits/Aurora/Aurora'));

interface BackgroundProps {
  /** Animation anhalten (im Player gehoert die Grafikleistung der Wiedergabe) */
  paused?: boolean;
  /** Ganze Flaeche einfaerben statt nur den oberen Rand (Anmeldeseite) */
  full?: boolean;
}

/**
 * Farbiger Hintergrund des Kestrel-Themes (React Bits: Aurora). Das Tempo ist einstellbar;
 * bei 0 oder "Bewegung reduzieren" bleibt der Verlauf stehen. Das Levin-Theme hat keinen.
 */
export function Background({ paused = false, full = false }: BackgroundProps) {
  const { theme, mode, motion, auroraSpeed } = usePrefs();
  const small = useMediaQuery('(max-width: 760px)');
  if (theme !== 'kestrel') return null;
  const stops = mode === 'dark' ? ['#0e7490', '#6d28d9', '#be185d'] : ['#67e8f9', '#c4b5fd', '#f9a8d4'];
  const still = !motion || auroraSpeed <= 0;
  return (
    <div className={`bg ${full ? 'bg--full' : ''}`} aria-hidden="true">
      <Suspense fallback={null}>
        <Aurora colorStops={stops} amplitude={1.1} blend={0.65} speed={0.45 * (auroraSpeed / 100)} layers={small ? 1 : 2} dpr={1}
                opacity={mode === 'dark' ? 0.6 : 0.9} mouseInteraction={false} paused={paused || still} intro={!still} />
      </Suspense>
      <div className="bg__veil" />
    </div>
  );
}
