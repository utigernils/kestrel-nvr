import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'soft' | 'ghost' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  icon?: ReactNode;
  active?: boolean;
  size?: 'sm' | 'md';
}

export function Button({ variant = 'soft', icon, active, size = 'md', className = '', children, type = 'button', ...rest }: ButtonProps) {
  const cls = ['btn', `btn--${variant}`, size === 'sm' ? 'btn--sm' : '', active ? 'is-active' : '', !children ? 'btn--icon' : '', className]
    .filter(Boolean).join(' ');
  return (
    <button type={type} className={cls} {...rest}>
      {icon}
      {children && <span>{children}</span>}
    </button>
  );
}
