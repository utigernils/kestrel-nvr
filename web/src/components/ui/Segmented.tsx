import type { ReactNode } from 'react';
import RubberSegment from '../reactbits/RubberSegment/RubberSegment';
import { usePrefs } from '../../context/PrefsContext';
import { useMediaQuery } from '../../hooks/useMediaQuery';

interface Option<T extends string> { value: T; label: ReactNode }

interface SegmentedProps<T extends string> {
  options: Option<T>[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  size?: 'sm' | 'md';
}

/** Umschalter. Im Kestrel-Theme mit elastischem Schieber (React Bits: RubberSegment), im Levin-Theme schlicht. */
export function Segmented<T extends string>({ options, value, onChange, label, size = 'sm' }: SegmentedProps<T>) {
  const { theme, palette: p } = usePrefs();
  // Mit dem Finger braucht jede Option 44 px Hoehe - dafuer die schlichte Variante.
  const coarse = useMediaQuery('(pointer: coarse)');
  if (theme === 'kestrel' && !coarse) {
    return (
      <RubberSegment items={options} value={value} onChange={v => onChange(v as T)} size={size} aria-label={label}
                     trackColor={p.surface2} thumbColor={p.primaryBg} textColor={p.mute} activeTextColor={p.primaryFg} className="segmented" />
    );
  }
  return (
    <div className={`seg seg--${size}`} role="radiogroup" aria-label={label}>
      {options.map(o => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value}
                className={`seg__item ${o.value === value ? 'is-on' : ''}`} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}
