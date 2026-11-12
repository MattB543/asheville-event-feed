'use client';

import { useEffect, useRef, useState } from 'react';
import DiscoBall from './DiscoBall';

const COLORS = ['#e9cf8a', '#fff6d6', '#c9cfdc', '#f3a6c8', '#b58a2a'];
// A disco track, played from Pixabay's site (its licence needs no credit)
const TRACK =
  'https://cdn.pixabay.com/download/audio/2026/01/24/audio_7ea9c9f394.mp3?filename=faultycrimal1-disco-party-472764.mp3';
// Without sound (blocked, or reduced to nothing), the party still lasts this long
const QUIET_PARTY_MS = 10_000;

type Piece = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  spin: number;
  turn: number;
  flutter: number;
  w: number;
  color: string;
};

// Random only after a tap, never during render, so the server and browser agree
function piece(x: number, y: number, angle: number, speed: number): Piece {
  return {
    x,
    y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    spin: Math.random() * Math.PI,
    turn: (Math.random() - 0.5) * 0.2,
    flutter: Math.random() * Math.PI * 2,
    w: 5 + Math.random() * 5,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
  };
}

/**
 * The hidden one: tap the disco ball and the party starts. The track plays and confetti
 * keeps falling until it ends, with a burst from the ball every few seconds; another tap
 * stops it.
 */
export default function Toast() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const ball = useRef<HTMLButtonElement>(null);
  const track = useRef<HTMLAudioElement>(null);
  const partyUntil = useRef(0);
  // One set of pieces and one drawing loop, even if a new party starts while the last falls
  const pieces = useRef<Piece[]>([]);
  const drawing = useRef(false);
  const frameId = useRef(0);
  const [partying, setPartying] = useState(false);

  // The track ending ends the party
  useEffect(() => {
    const el = track.current;
    const end = () => {
      partyUntil.current = 0;
      setPartying(false);
    };
    el?.addEventListener('ended', end);
    return () => {
      el?.removeEventListener('ended', end);
      // Leaving the page ends the party, rather than drawing on for the rest of the track
      partyUntil.current = 0;
      pieces.current = [];
      cancelAnimationFrame(frameId.current);
      drawing.current = false;
    };
  }, []);

  const burstFromBall = (count: number) => {
    const from = ball.current?.getBoundingClientRect();
    if (!from || from.bottom < 0) return;
    for (let i = 0; i < count; i++) {
      pieces.current.push(
        piece(
          from.left + from.width / 2,
          from.top + from.height / 3,
          -Math.PI / 2 + (Math.random() - 0.5) * 2.2,
          3 + Math.random() * 10
        )
      );
    }
  };

  const stop = () => {
    track.current?.pause();
    partyUntil.current = 0;
    setPartying(false);
  };

  const start = () => {
    // Less motion asked for: the music plays, with no bounce and no confetti
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const sound = track.current;
    if (sound) {
      sound.currentTime = 0;
      // Blocked sound is fine: the confetti still flies, for a while
      sound.play().catch(() => {
        partyUntil.current = Math.min(partyUntil.current, performance.now() + QUIET_PARTY_MS);
        // With no confetti either there is no party to stop
        if (still) setPartying(false);
      });
    }
    partyUntil.current =
      performance.now() + (sound?.duration ? sound.duration * 1000 : QUIET_PARTY_MS);
    setPartying(true);

    const el = canvas.current;
    const ctx = el?.getContext('2d');
    if (!el || !ctx || still) return;
    ball.current?.animate(
      [
        { transform: 'scale(1)' },
        { transform: 'scale(1.15) rotate(-4deg)' },
        { transform: 'scale(1)' },
      ],
      { duration: 350, easing: 'ease-out' }
    );
    const dpr = devicePixelRatio || 1;
    el.width = innerWidth * dpr;
    el.height = innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    burstFromBall(600);
    if (drawing.current) return;
    drawing.current = true;
    let lastBurst = performance.now();
    const frame = (time: number) => {
      const on = time < partyUntil.current;
      if (on) {
        // A steady fall from the top of the window, and another burst every few seconds
        for (let i = 0; i < 3; i++) {
          pieces.current.push(
            piece(Math.random() * innerWidth, -10, Math.PI / 2, 0.5 + Math.random())
          );
        }
        if (time - lastBurst > 4000) {
          burstFromBall(250);
          lastBurst = time;
        }
      }
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      const all = pieces.current;
      for (let i = all.length - 1; i >= 0; i--) {
        const p = all[i];
        // Light gravity and plenty of air, so it drifts down like paper
        p.vy = Math.min(p.vy + 0.08, 1.6);
        p.vx *= 0.985;
        p.x += p.vx + Math.sin(time / 300 + p.flutter) * 0.6;
        p.y += p.vy;
        p.spin += p.turn;
        if (p.y > innerHeight + 20) {
          all.splice(i, 1);
          continue;
        }
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.spin);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.w / 4, p.w, p.w / 2);
        ctx.restore();
      }
      // Once the party's over, the last pieces finish falling
      if (on || all.length > 0) frameId.current = requestAnimationFrame(frame);
      else {
        drawing.current = false;
        // Covers a party whose track never started (the browser blocked it). A track still
        // playing ends the party itself (iOS doesn't know its length until then)
        if (track.current?.paused !== false) setPartying(false);
      }
    };
    frameId.current = requestAnimationFrame(frame);
  };

  return (
    <>
      {/* Only its length is fetched with the page (it sets how long the confetti falls); the
          track itself waits for a tap */}
      <audio ref={track} src={TRACK} preload="metadata" />
      <button
        ref={ball}
        type="button"
        onClick={partying ? stop : start}
        aria-label={partying ? 'Stop the party' : 'Start the party'}
        aria-pressed={partying}
        className="mx-auto block cursor-pointer rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#e9cf8a]"
      >
        <DiscoBall size={96} spin />
      </button>
      <canvas
        ref={canvas}
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-50 h-full w-full"
      />
    </>
  );
}
