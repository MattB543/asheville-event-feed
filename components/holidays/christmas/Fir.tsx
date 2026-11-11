/** A Fraser fir with a gold star on top: the page's mark, and its badge beside the header logo */
export default function Fir({ size = 24, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={`shrink-0 ${className}`}
    >
      <path d="M32 10 L46 30 H40 L52 46 H42 L56 60 H8 L22 46 H12 L24 30 H18 Z" fill="#2f7a4f" />
      <path d="M32 10 L46 30 H40 L52 46 H42 L56 60 H32 Z" fill="#225f3c" />
      <rect x="28" y="58" width="8" height="6" fill="#7a4a2a" />
      <path
        d="M32 1 L34.6 7 L41 7.4 L36 11.4 L37.7 17.6 L32 14 L26.3 17.6 L28 11.4 L23 7.4 L29.4 7 Z"
        fill="#e7c873"
      />
      <circle className="xmas-light" cx="26" cy="38" r="2.2" fill="#9f1239" />
      <circle className="xmas-light" cx="38" cy="52" r="2.2" fill="#9f1239" />
      <circle className="xmas-light" cx="35" cy="26" r="1.8" fill="#e7c873" />
      <circle className="xmas-light" cx="22" cy="53" r="1.8" fill="#e7c873" />
    </svg>
  );
}
