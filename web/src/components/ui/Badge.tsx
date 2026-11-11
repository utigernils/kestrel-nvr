import type { ReactNode } from 'react';

type Tone = 'neutral' | 'ok' | 'warn' | 'bad' | 'accent';

export function Badge({ tone = 'neutral', children, color }: { tone?: Tone; children: ReactNode; color?: string }) {
  return (
    <span className={`badge badge--${tone}`} style={color ? { color, borderColor: `${color}55`, background: `${color}1a` } : undefined}>
      {children}
    </span>
  );
}

export function StatusDot({ state }: { state: string }) {
  const tone = state === 'online' ? 'ok' : state === 'fehler' ? 'bad' : state === 'verbinde' ? 'warn' : 'neutral';
  return <i className={`dot dot--${tone}`} aria-hidden="true" />;
}
