// Tail feathers fanned behind the body, outermost first: angle and colour
const FEATHERS: [number, string][] = [
  [-70, '#8f1d2c'],
  [-47, '#c8702a'],
  [-23, '#e2a23b'],
  [0, '#8f1d2c'],
  [23, '#e2a23b'],
  [47, '#c8702a'],
  [70, '#8f1d2c'],
];

/** A round little turkey: the page's mark, and its badge beside the header logo */
export default function Turkey({
  size = 24,
  className = '',
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={`shrink-0 ${className}`}
    >
      {FEATHERS.map(([angle, color]) => (
        <ellipse
          key={angle}
          cx="32"
          cy="18"
          rx="7"
          ry="17"
          fill={color}
          transform={`rotate(${angle} 32 38)`}
        />
      ))}
      <ellipse cx="32" cy="42" rx="15" ry="16" fill="#6b3b1f" />
      <ellipse cx="32" cy="46" rx="9" ry="9" fill="#8a5230" />
      <circle cx="32" cy="27" r="9" fill="#7a4527" />
      <circle cx="28.5" cy="25" r="2" fill="#fffaf0" />
      <circle cx="35.5" cy="25" r="2" fill="#fffaf0" />
      <circle cx="28.8" cy="25.3" r="1" fill="#2a1a14" />
      <circle cx="35.2" cy="25.3" r="1" fill="#2a1a14" />
      <path d="M29.5 28.5 L34.5 28.5 L32 32 Z" fill="#e2a23b" />
      <path d="M33.5 31 C36 33 35.5 37 33 37 C31.5 37 32 34 33.5 31 Z" fill="#c42b3a" />
      <path
        d="M26 57 l-2 5 M30 58 l0 5 M38 57 l2 5 M34 58 l0 5"
        stroke="#e2a23b"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
