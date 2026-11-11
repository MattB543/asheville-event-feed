/** Two champagne flutes clinking, with a spark where they meet: the page's mark, and its
 * badge beside the header logo */
export default function Glasses({
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
      <g transform="rotate(-14 22 40)">
        <path d="M14 10 H30 L28 30 Q22 36 16 30 Z" fill="#f3dc8c" />
        <path d="M14 10 H30 L29.4 16 H14.6 Z" fill="#fff6d6" />
        <path d="M14 10 H30 L28 30 Q22 36 16 30 Z" fill="none" stroke="#b58a2a" strokeWidth="1.6" />
        <path d="M22 34 V52 M15 54 H29" stroke="#b58a2a" strokeWidth="2.4" strokeLinecap="round" />
      </g>
      <g transform="rotate(14 42 40)">
        <path d="M34 10 H50 L48 30 Q42 36 36 30 Z" fill="#f3dc8c" />
        <path d="M34 10 H50 L49.4 16 H34.6 Z" fill="#fff6d6" />
        <path d="M34 10 H50 L48 30 Q42 36 36 30 Z" fill="none" stroke="#b58a2a" strokeWidth="1.6" />
        <path d="M42 34 V52 M35 54 H49" stroke="#b58a2a" strokeWidth="2.4" strokeLinecap="round" />
      </g>
      <path
        d="M32 2 L33.4 6.6 L38 8 L33.4 9.4 L32 14 L30.6 9.4 L26 8 L30.6 6.6 Z"
        fill="#fff6d6"
        stroke="#e9cf8a"
        strokeWidth="0.8"
      />
      <circle cx="21" cy="22" r="1.1" fill="#fff6d6" />
      <circle cx="44" cy="20" r="1.1" fill="#fff6d6" />
      <circle cx="42" cy="25" r="0.8" fill="#fff6d6" />
    </svg>
  );
}
