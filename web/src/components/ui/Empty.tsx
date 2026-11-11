import type { ReactNode } from 'react';

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      {icon && <div className="empty__icon">{icon}</div>}
      <h3>{title}</h3>
      {children && <div className="muted">{children}</div>}
    </div>
  );
}
