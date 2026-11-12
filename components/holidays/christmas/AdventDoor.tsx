'use client';

import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { bodoni } from './fonts';

// Doors a visitor has opened stay open on their next visit, like a real calendar
const STORAGE_KEY = 'christmasDoorsOpened';
const FRONTS = ['#9f1239', '#1f5c3a', '#7c2d12'];

function opened(): string[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}

function remember(day: string) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...new Set([...opened(), day])]));
  } catch {
    // Private windows: the door just closes again next visit
  }
}

const noSubscription = () => () => {};

// A shake of sleigh bells (a clip of BigSoundBank's "Bells of Santa Claus #1", CC0)
function playBells() {
  const bells = new Audio('/christmas/sleigh-bells.mp3');
  bells.volume = 0.4;
  // Blocked sound is fine: the door still opens
  bells.play().catch(() => {});
}

/** One day's door: closed it shows the date, and a click swings it open onto the day's events */
export default function AdventDoor({
  day,
  weekday,
  today,
  children,
}: {
  day: string;
  weekday: string;
  today: boolean;
  children: ReactNode;
}) {
  const [clicked, setClicked] = useState(false);
  // Read after hydration, so the server's closed doors match the first render
  const remembered = useSyncExternalStore(
    noSubscription,
    () => opened().includes(day),
    () => false
  );
  const open = clicked || remembered;
  const number = Number(day.slice(8));
  const christmas = day.endsWith('-12-25');

  // Today's door swings open by itself, a moment after the page appears
  useEffect(() => {
    if (!today) return;
    const timer = setTimeout(() => {
      setClicked(true);
      remember(day);
    }, 600);
    return () => clearTimeout(timer);
  }, [day, today]);

  const openDoor = () => {
    setClicked(true);
    remember(day);
    playBells();
  };

  return (
    <li data-snow-surface className="relative [perspective:1400px]">
      <button
        type="button"
        onClick={openDoor}
        data-open={open}
        aria-expanded={open}
        // Swung open it is invisible, so Tab skips it and goes on into the day's events
        tabIndex={open ? -1 : undefined}
        aria-label={`Open ${weekday} the ${number}`}
        className="xmas-door absolute inset-0 z-10 cursor-pointer rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e7c873]"
      >
        <span
          className="xmas-face absolute inset-0 flex flex-col items-center justify-center rounded-sm shadow-[0_10px_24px_rgba(0,0,0,.4)]"
          style={{ background: christmas ? '#c9a24a' : FRONTS[number % FRONTS.length] }}
        >
          <span
            aria-hidden="true"
            className="absolute inset-2 rounded-sm border-2 border-[#e7c873]/50"
          />
          <span
            className={`${bodoni.className} text-7xl font-bold leading-none ${
              christmas ? 'text-[#9f1239]' : 'text-[#f6efe2]'
            }`}
          >
            {number}
          </span>
          <span
            className={`mt-2 text-sm font-semibold ${christmas ? 'text-[#10291f]' : 'text-[#e7c873]'}`}
          >
            {weekday}
          </span>
          {/* The knob */}
          <span
            aria-hidden="true"
            className="absolute right-4 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-[#e7c873] shadow-[0_1px_2px_rgba(0,0,0,.5)]"
          />
        </span>
        <span
          aria-hidden="true"
          className="xmas-face xmas-back absolute inset-0 rounded-sm bg-[#0b1f17] shadow-[inset_0_0_0_2px_rgba(231,200,115,.35)]"
        />
      </button>
      {/* Behind a closed door nothing can be reached, by Tab or by a screen reader */}
      <div
        inert={!open}
        className="isolate h-full rounded-sm bg-[#f6efe2] p-4 text-[#10291f] shadow-[inset_0_0_0_1px_rgba(16,41,31,.1),0_10px_24px_rgba(0,0,0,.35)] sm:p-5"
      >
        {children}
      </div>
    </li>
  );
}
