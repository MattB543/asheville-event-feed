'use client';

import { useRef } from 'react';
import Turkey from './Turkey';

// A cartoon scream, played from Pixabay's site (its licence needs no credit): the turkey
// only talks this month
const SCREAM =
  'https://cdn.pixabay.com/download/audio/2025/04/07/audio_e1f2e06d79.mp3?filename=universfield-cartoon-scream-323779.mp3';

/** The hidden one: tap the turkey and it screams and flaps */
export default function SquawkingTurkey() {
  const turkey = useRef<HTMLSpanElement>(null);
  const scream = useRef<HTMLAudioElement>(null);

  const squawk = () => {
    const sound = scream.current;
    if (sound) {
      sound.currentTime = 0;
      // Blocked sound is fine: the turkey still flaps
      sound.play().catch(() => {});
    }
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    turkey.current?.animate(
      [
        { transform: 'rotate(0)' },
        { transform: 'rotate(-12deg) translateY(-6px)' },
        { transform: 'rotate(10deg) translateY(-10px)' },
        { transform: 'rotate(-8deg) translateY(-4px)' },
        { transform: 'rotate(0)' },
      ],
      { duration: 600, easing: 'ease-out' }
    );
  };

  return (
    <button
      type="button"
      onClick={squawk}
      aria-label="Squawk"
      className="mx-auto block cursor-pointer rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#8f1d2c]"
    >
      {/* Fetched with the page, so the first tap screams at once instead of after a download */}
      <audio ref={scream} src={SCREAM} preload="auto" />
      <span ref={turkey} className="block">
        <Turkey size={72} />
      </span>
    </button>
  );
}
