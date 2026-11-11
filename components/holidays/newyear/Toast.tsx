'use client';

import { useRef } from 'react';
import Glasses from './Glasses';

const COLORS = ['#e9cf8a', '#fff6d6', '#c9cfdc', '#f3a6c8', '#b58a2a'];

/** The hidden one: clink the glasses and confetti bursts out of them */
export default function Toast() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const glasses = useRef<HTMLButtonElement>(null);

  const burst = () => {
    glasses.current?.animate(
      [
        { transform: 'scale(1)' },
        { transform: 'scale(1.15) rotate(-4deg)' },
        { transform: 'scale(1)' },
      ],
      { duration: 350, easing: 'ease-out' }
    );
    const el = canvas.current;
    const ctx = el?.getContext('2d');
    const from = glasses.current?.getBoundingClientRect();
    if (!el || !ctx || !from || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const dpr = devicePixelRatio || 1;
    el.width = innerWidth * dpr;
    el.height = innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Random only after a tap, never during render, so the server and browser agree
    const pieces = Array.from({ length: 140 }, () => {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.6;
      const speed = 6 + Math.random() * 9;
      return {
        x: from.left + from.width / 2,
        y: from.top + from.height / 3,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        spin: Math.random() * Math.PI,
        turn: (Math.random() - 0.5) * 0.3,
        w: 5 + Math.random() * 5,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
      };
    });
    const started = performance.now();
    const frame = (time: number) => {
      const age = time - started;
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      ctx.globalAlpha = Math.max(0, 1 - age / 3200);
      for (const p of pieces) {
        p.vy += 0.25;
        p.vx *= 0.99;
        p.x += p.vx;
        p.y += p.vy;
        p.spin += p.turn;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.spin);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.w / 4, p.w, p.w / 2);
        ctx.restore();
      }
      if (age < 3200) requestAnimationFrame(frame);
      else ctx.clearRect(0, 0, innerWidth, innerHeight);
    };
    requestAnimationFrame(frame);
  };

  return (
    <>
      <button
        ref={glasses}
        type="button"
        onClick={burst}
        aria-label="Cheers"
        className="mx-auto block cursor-pointer rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#e9cf8a]"
      >
        <Glasses size={84} />
      </button>
      <canvas
        ref={canvas}
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-50 h-full w-full"
      />
    </>
  );
}
