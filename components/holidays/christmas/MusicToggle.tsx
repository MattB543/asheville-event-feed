'use client';

import { useEffect, useRef, useState } from 'react';
import { Coffee, Flame, Snowflake, type LucideIcon } from 'lucide-react';
import { setSnow } from './snow';

// Played from Pixabay's and BigSoundBank's own sites: they only have to last the season.
// Pixabay's licence and BigSoundBank's CC0 both allow this without credit.
const SOUNDS: { name: string; icon: LucideIcon; src: string; snow?: boolean }[] = [
  {
    name: 'Winter ambience',
    icon: Snowflake,
    // Winter ambience brings the snow with it
    snow: true,
    src: 'https://cdn.pixabay.com/download/audio/2026/10/23/audio_7cbfa21ed3.mp3?filename=atlasaudio-winter-ambience-625744.mp3',
  },
  {
    name: 'Cozy soulful music',
    icon: Coffee,
    src: 'https://cdn.pixabay.com/download/audio/2026/09/07/audio_dee63bb366.mp3?filename=andriih-cozy-soulful-music-599220.mp3',
  },
  { name: 'Crackling fire', icon: Flame, src: 'https://bigsoundbank.com/UPLOAD/mp3/2855.mp3' },
];

/** A little record player with three sounds to pick from. Off until tapped: browsers only
 * play sound after a visitor has clicked something */
export default function MusicToggle() {
  const [playing, setPlaying] = useState(false);
  const [chosen, setChosen] = useState(0);
  const audio = useRef<HTMLAudioElement>(null);

  const snowWith = playing && SOUNDS[chosen].snow === true;
  useEffect(() => {
    setSnow('music', snowWith);
    return () => setSnow('music', false);
  }, [snowWith]);

  // Each icon is its own play/pause: tap the one playing to stop it, another to switch
  const press = (index: number) => {
    const el = audio.current;
    if (!el) return;
    if (playing && index === chosen) {
      el.pause();
      setPlaying(false);
      return;
    }
    if (index !== chosen) {
      el.src = SOUNDS[index].src;
      setChosen(index);
    }
    el.play().catch(() => setPlaying(false));
    setPlaying(true);
  };

  return (
    <div className="absolute right-4 top-4 z-10 flex items-center gap-1 rounded-full bg-[#9f1239] py-2 pl-2 pr-2 text-[#e7c873] shadow-[0_6px_16px_rgba(0,0,0,.4)] ring-2 ring-[#c9a24a] sm:right-6 sm:top-6">
      <audio ref={audio} src={SOUNDS[0].src} loop preload="none" />
      {/* The record, which turns while a sound plays; its shine shows it turning */}
      <span
        aria-hidden="true"
        className={`relative mr-1 h-12 w-12 rounded-full ${playing ? 'xmas-spin' : ''}`}
        style={{
          background:
            'radial-gradient(circle, #f6efe2 0 1.5px, #9f1239 2px 10px, transparent 10.5px), conic-gradient(from 20deg, transparent 0 40deg, rgba(255,255,255,.22) 60deg, transparent 80deg 220deg, rgba(255,255,255,.16) 240deg, transparent 260deg), repeating-radial-gradient(circle, #151515 0 1.5px, #262626 1.5px 3px)',
        }}
      />
      {SOUNDS.map(({ name, icon: SoundIcon }, i) => (
        <button
          key={name}
          type="button"
          onClick={() => press(i)}
          aria-pressed={playing && i === chosen}
          aria-label={
            playing && i === chosen ? `Pause ${name.toLowerCase()}` : `Play ${name.toLowerCase()}`
          }
          className={`flex h-9 w-9 cursor-pointer items-center justify-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e7c873] ${
            playing && i === chosen ? 'bg-[#e7c873] text-[#9f1239]' : 'hover:bg-white/10'
          }`}
        >
          <SoundIcon size={18} aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}
