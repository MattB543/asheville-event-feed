// Three reindeer and the sleigh, as a silhouette in the text colour, facing right
const REINDEER_X = [62, 84, 106];

function Reindeer({ x }: { x: number }) {
  return (
    <g transform={`translate(${x} 0)`}>
      <ellipse cx="9" cy="13" rx="7" ry="3.2" />
      <path d="M14 12 L17.5 6.5 L19.5 7.5 L16.5 13 Z" />
      <ellipse cx="19.8" cy="6.2" rx="2.4" ry="1.5" />
      <g fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round">
        <path d="M19 5 L17.5 1.5 M17.9 2.6 L16 2 M18.6 4 L20.5 1.2" />
        <path d="M14 15 L17.5 18 M13 15.5 L14.5 20 M5 15 L1.5 17 M6 15.5 L4 20" />
        <path d="M2.5 12 L0.5 10.5" />
      </g>
    </g>
  );
}

export default function SantaSleigh({ className = '' }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 132 26" className={className} fill="currentColor">
      {/* The reins */}
      <path d="M44 12 Q85 16 124 7" fill="none" stroke="currentColor" strokeWidth="0.7" />
      {REINDEER_X.map((x) => (
        <Reindeer key={x} x={x} />
      ))}
      {/* Santa: hat, head and body, sitting in the sleigh */}
      <path d="M24 4 L30 1 L33 7 Z" />
      <circle cx="23.5" cy="4" r="1.3" />
      <circle cx="30.5" cy="8" r="3" />
      <path d="M25 12 Q30 7 35 12 L35 16 L25 16 Z" />
      {/* The sack behind him */}
      <ellipse cx="18" cy="12" rx="5" ry="4.5" />
      {/* The sleigh, with its curled front and runner */}
      <path d="M12 14 L40 14 Q45 14 45 9 Q47 9 47 12 Q47 19 39 19 L16 19 Q12 19 12 14 Z" />
      <path
        d="M10 23 L42 23 Q48 23 49 18"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path d="M18 19 L17 23 M36 19 L37 23" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}
