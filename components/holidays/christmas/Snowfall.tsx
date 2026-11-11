'use client';

import { useEffect, useRef } from 'react';

// Pile heights are kept per strip of this many pixels along each surface's top edge
const STRIP = 3;
const MAX_PILE = 18;
const SPREAD = [
  [-2, 0.1],
  [-1, 0.2],
  [0, 0.4],
  [1, 0.2],
  [2, 0.1],
] as const;

type Flake = { x: number; y: number; r: number; speed: number; phase: number; sway: number };

/** A soft white dot, drawn once and stamped for every flake */
function flakeSprite(): HTMLCanvasElement {
  const sprite = document.createElement('canvas');
  sprite.width = sprite.height = 32;
  const ctx = sprite.getContext('2d')!;
  const glow = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  glow.addColorStop(0, 'rgba(255,255,255,1)');
  glow.addColorStop(0.45, 'rgba(255,255,255,.85)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 32, 32);
  return sprite;
}

/**
 * Snow over the whole window while `falling`. A flake that reaches the top of a
 * `[data-snow-surface]` element lands there, and the snow piles up along that edge,
 * moving with the page as it scrolls; once the snow stops, the piles melt away.
 */
export default function Snowfall({ falling }: { falling: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const fallingRef = useRef(falling);
  const start = useRef<() => void>(() => {});

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext('2d');
    if (!el || !ctx || matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const sprite = flakeSprite();
    const piles = new Map<Element, Float32Array>();
    let width = 0;
    let height = 0;
    const resize = () => {
      const dpr = devicePixelRatio || 1;
      width = innerWidth;
      height = innerHeight;
      el.width = width * dpr;
      el.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    addEventListener('resize', resize);

    const count = width < 640 ? 70 : 140;
    const spawn = (anywhere: boolean): Flake => {
      const r = 1 + Math.random() ** 2 * 3.5;
      return {
        x: Math.random() * width,
        y: anywhere ? Math.random() * height : -10,
        r,
        // Big flakes are nearer, so they fall faster
        speed: 0.35 + r * 0.3,
        phase: Math.random() * Math.PI * 2,
        sway: 0.2 + Math.random() * 0.6,
      };
    };
    const flakes = Array.from({ length: count }, () => spawn(true));

    // Snow slides off a steep side, so each strip is never far above its neighbours
    const settle = (pile: Float32Array, i: number) => {
      for (const j of [i - 1, i + 1]) {
        if (j < 0 || j >= pile.length) continue;
        const excess = pile[i] - pile[j] - 0.8;
        if (excess > 0) {
          pile[i] -= excess / 2;
          pile[j] += excess / 2;
          settle(pile, j);
        }
      }
    };

    let frame = 0;
    let t = 0;
    const draw = () => {
      t += 1;
      ctx.clearRect(0, 0, width, height);
      const surfaces = [...document.querySelectorAll('[data-snow-surface]')].map((s) => ({
        s,
        rect: s.getBoundingClientRect(),
      }));

      const snowing = fallingRef.current;
      let melting = false;
      for (const { s, rect } of surfaces) {
        const strips = Math.max(1, Math.round(rect.width / STRIP));
        let pile = piles.get(s);
        if (!pile || pile.length !== strips) {
          pile = new Float32Array(strips);
          piles.set(s, pile);
        }
        if (!snowing) {
          for (let i = 0; i < pile.length; i++) pile[i] = Math.max(0, pile[i] - 0.04);
        }
        if (pile.some((h) => h > 0.3)) melting = true;
        if (rect.bottom < 0 || rect.top > height + MAX_PILE) continue;
        ctx.beginPath();
        ctx.moveTo(rect.left, rect.top);
        // Curves through the strips' midpoints, so the top reads as snow, not a bar chart
        const step = rect.width / pile.length;
        for (let i = 0; i < pile.length - 1; i++) {
          const x = rect.left + (i + 0.5) * step;
          ctx.quadraticCurveTo(
            x,
            rect.top - pile[i],
            x + step / 2,
            rect.top - (pile[i] + pile[i + 1]) / 2
          );
        }
        ctx.lineTo(rect.right, rect.top);
        ctx.closePath();
        ctx.fillStyle = '#fbfaf6';
        ctx.shadowColor = 'rgba(0,0,0,.25)';
        ctx.shadowBlur = 3;
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      let airborne = false;
      for (let n = 0; n < flakes.length; n++) {
        const f = flakes[n];
        if (f.y > height + 10) {
          if (!snowing) continue;
          flakes[n] = spawn(false);
          continue;
        }
        airborne = true;
        const nextY = f.y + f.speed;
        const x = f.x + Math.sin(t * 0.02 + f.phase) * f.sway * 2;
        // Landing: crossing the current top of the snow on a surface beneath
        const hit = surfaces.find(
          ({ rect }) =>
            x > rect.left && x < rect.right && f.y <= rect.top && nextY >= rect.top - MAX_PILE
        );
        if (hit) {
          const pile = piles.get(hit.s)!;
          const i = Math.min(
            pile.length - 1,
            Math.floor(((x - hit.rect.left) / hit.rect.width) * pile.length)
          );
          if (nextY >= hit.rect.top - pile[i]) {
            // A flake spreads a little as it lands, so the pile grows as a soft mound
            for (const [offset, share] of SPREAD) {
              const j = i + offset;
              if (j < 0 || j >= pile.length) continue;
              pile[j] = Math.min(MAX_PILE, pile[j] + f.r * 0.7 * share);
              settle(pile, j);
            }
            flakes[n] = snowing ? spawn(false) : { ...f, y: height + 20 };
            continue;
          }
        }
        f.y = nextY;
        ctx.globalAlpha = 0.55 + f.r / 9;
        ctx.drawImage(sprite, x - f.r * 1.6, f.y - f.r * 1.6, f.r * 3.2, f.r * 3.2);
        ctx.globalAlpha = 1;
      }

      // Runs until the last flake has landed and the last pile has melted
      if (snowing || airborne || melting) frame = requestAnimationFrame(draw);
      else running = false;
    };
    let running = false;
    start.current = () => {
      if (running) return;
      running = true;
      frame = requestAnimationFrame(draw);
    };
    if (fallingRef.current) start.current();
    return () => {
      cancelAnimationFrame(frame);
      removeEventListener('resize', resize);
    };
  }, []);

  useEffect(() => {
    fallingRef.current = falling;
    if (falling) start.current();
  }, [falling]);

  return (
    <canvas
      ref={canvas}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-50 h-full w-full"
    />
  );
}
