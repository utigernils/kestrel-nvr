import type { HTMLAttributes, ReactNode } from 'react';

interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: ReactNode;
  actions?: ReactNode;
  padded?: boolean;
}

/** Deckende Karte mit optionalem Titel und Aktionen. */
export function Card({ title, actions, padded = true, className = '', children, ...rest }: CardProps) {
  return (
    <div className={`card ${padded ? 'card--padded' : ''} ${className}`} {...rest}>
      {(title || actions) && (
        <div className="card__head">
          {title && <h2 className="card__title">{title}</h2>}
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      {children}
    </div>
  );
}
