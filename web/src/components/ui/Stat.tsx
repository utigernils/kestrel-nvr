import type { ReactNode } from 'react';
import CountUp from '../reactbits/CountUp/CountUp';
import { usePrefs } from '../../context/PrefsContext';
import { locale } from '../../i18n';

interface StatProps {
  label: string;
  value: number;
  decimals?: number;
  suffix?: string;
  hint?: ReactNode;
}

/** Kennzahl. Im Kestrel-Theme zaehlt sie beim Erscheinen hoch (React Bits: CountUp). */
export function Stat({ label, value, decimals = 0, suffix = '', hint }: StatProps) {
  const { theme, motion } = usePrefs();
  const animations = motion && theme === 'kestrel';
  return (
    <div className="stat">
      <div className="stat__label">{label}</div>
      <div className="stat__value">
        {animations ? <CountUp to={value} decimals={decimals} duration={0.8} separator={locale().startsWith('de') ? '’' : ','} /> : value.toFixed(decimals)}
        {suffix && <span className="stat__suffix">{suffix}</span>}
      </div>
      {hint && <div className="stat__hint">{hint}</div>}
    </div>
  );
}

export function Meter({ value, tone = 'accent' }: { value: number; tone?: 'accent' | 'warn' | 'bad' }) {
  return (
    <div className="meter" role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
      <i className={`meter__fill meter__fill--${tone}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}
