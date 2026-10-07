// The Mysl mark: a thought cloud with two trailing dots on a plum tile. Drawn for Mysl; see design/brand/.
export function LogoMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden focusable="false" className={className}>
      <rect width="64" height="64" rx="16" fill="#8a2b6e" />
      <g fill="#ffffff">
        <circle cx="27" cy="29" r="10" />
        <circle cx="38" cy="23" r="12" />
        <circle cx="47" cy="31" r="9" />
        <rect x="27" y="29" width="20" height="11" rx="5.5" />
        <circle cx="18" cy="46" r="4.5" />
        <circle cx="11" cy="54" r="3" />
      </g>
    </svg>
  );
}

export function Wordmark({ size = 28 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2 font-bold tracking-tight text-text" style={{ fontSize: size * 0.72 }}>
      <LogoMark size={size} />
      <span>Мысль</span>
    </span>
  );
}
