/** A fork, set to the left of the menu on wide screens */
export function Fork({ className = '' }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 40 300" className={className}>
      <g fill="#c9ccd1" stroke="#8d939b" strokeWidth="1.5">
        {[6, 15, 24, 33].map((x) => (
          <rect key={x} x={x - 2} y="4" width="4" height="70" rx="2" />
        ))}
        <path d="M4 66 Q4 96 20 104 Q36 96 36 66 Z" />
        <rect x="15" y="100" width="10" height="196" rx="5" />
      </g>
    </svg>
  );
}

/** A knife, set to the right of the menu */
export function Knife({ className = '' }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 40 300" className={className}>
      <g fill="#c9ccd1" stroke="#8d939b" strokeWidth="1.5">
        <path d="M14 4 Q34 20 32 120 L14 120 Z" />
        <rect x="13" y="118" width="12" height="178" rx="6" />
      </g>
    </svg>
  );
}

/** A small rule with a leaf at its centre, between the menu's courses */
export function Flourish() {
  return (
    <div aria-hidden="true" className="flex items-center justify-center gap-3 py-2">
      <span className="h-px w-16 bg-[#8f1d2c]/40" />
      <svg viewBox="0 0 24 24" className="h-5 w-5">
        <path
          fill="#c8702a"
          d="M12 2 C16 6 20 8 20 13 C20 18 16 21 12 22 C8 21 4 18 4 13 C4 8 8 6 12 2 Z"
        />
        <path stroke="#7a3d14" strokeWidth="1.2" d="M12 5 V21" />
      </svg>
      <span className="h-px w-16 bg-[#8f1d2c]/40" />
    </div>
  );
}
