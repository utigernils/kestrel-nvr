export function BrandMark({ size = 26 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className="brand__mark" aria-hidden="true">
      <path d="M3 13c4-7 10-9 18-8-2 2-3 3-3 5 0 5-4 9-9 9-3 0-5-2-6-6z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx="14.5" cy="9.5" r="1.2" fill="currentColor" />
    </svg>
  );
}

export function Brand({ version }: { version?: string }) {
  return (
    <div className="brand">
      <BrandMark />
      <span className="brand__name">Kestrel</span>
      {version && <span className="brand__ver">v{version}</span>}
    </div>
  );
}
