'use client';

import { useSyncExternalStore } from 'react';
import { limelight } from './fonts';

const tick = (onTick: () => void) => {
  const timer = setInterval(onTick, 1000);
  return () => clearInterval(timer);
};

// Each unit's length and how many make the next one up (days just keep counting)
const UNITS: [string, number, number][] = [
  ['days', 86_400_000, Infinity],
  ['hours', 3_600_000, 24],
  ['minutes', 60_000, 60],
  ['seconds', 1000, 60],
];

/** Days, hours, minutes and seconds to midnight; blank until the browser takes over, since
 * the server's clock and the visitor's would disagree by the time the page arrives */
export default function Countdown({ midnight }: { midnight: string }) {
  const now = useSyncExternalStore(
    tick,
    () => Math.floor(Date.now() / 1000),
    () => null
  );
  const left = now === null ? null : Date.parse(midnight) - now * 1000;

  if (left !== null && left <= 0) {
    return (
      <p className={`${limelight.className} mt-8 text-4xl text-[#e9cf8a] sm:text-5xl`}>
        Happy New Year!
      </p>
    );
  }
  return (
    <div
      role="timer"
      aria-label="Time to midnight"
      className="mt-8 flex justify-center gap-2 sm:gap-4"
    >
      {UNITS.map(([label, ms, per]) => {
        const value = Math.floor((left ?? 0) / ms) % per;
        return (
          <div
            key={label}
            className="w-[4.5rem] rounded-sm border border-[#e9cf8a]/30 bg-white/5 py-3 sm:w-24"
          >
            <span
              className={`${limelight.className} block text-3xl tabular-nums text-[#fff6d6] sm:text-5xl`}
            >
              {left === null ? '–' : String(value).padStart(2, '0')}
            </span>
            <span className="mt-1 block text-xs text-[#c9cfdc]">{label}</span>
          </div>
        );
      })}
    </div>
  );
}
