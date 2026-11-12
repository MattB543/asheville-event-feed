'use client';

import { useEffect, useState } from 'react';

const CX = 32;
const CY = 39;
const R = 21;
const BANDS = 10;
const AROUND = 24;
const LIGHTS = ['#ffffff', '#f3a6c8', '#9ec9f5', '#e9cf8a'];
// The light comes from the upper left, a little in front
const LIGHT = (() => {
  const [x, y, z] = [-0.5, 0.6, 0.65];
  const n = Math.hypot(x, y, z);
  return [x / n, y / n, z / n];
})();

/** The mirror tiles facing the viewer when the ball has turned `turn` radians, as polygons
 * on the sphere, shaded by how squarely each one faces the light */
function tiles(turn: number) {
  const out: { points: string; fill: string; key: string }[] = [];
  for (let band = 0; band < BANDS; band++) {
    const lat0 = -Math.PI / 2 + (band * Math.PI) / BANDS;
    const lat1 = lat0 + Math.PI / BANDS;
    for (let step = 0; step < AROUND; step++) {
      const lon0 = turn + (step * 2 * Math.PI) / AROUND;
      const lon1 = lon0 + (2 * Math.PI) / AROUND;
      const latC = (lat0 + lat1) / 2;
      const lonC = (lon0 + lon1) / 2;
      // Its normal: facing away from the viewer, it's on the back of the ball
      const nx = Math.cos(latC) * Math.sin(lonC);
      const ny = Math.sin(latC);
      const nz = Math.cos(latC) * Math.cos(lonC);
      if (nz <= 0.02) continue;
      const corner = (lat: number, lon: number) =>
        `${(CX + R * Math.cos(lat) * Math.sin(lon)).toFixed(2)},${(CY - R * Math.sin(lat)).toFixed(2)}`;
      const facing = Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]);
      // A few tiles hold a coloured light, and flash as they turn towards it
      const coloured = (band * 7 + step * 3) % 5 === 0;
      const fill =
        facing > 0.93
          ? '#ffffff'
          : coloured && facing > 0.4
            ? LIGHTS[(band + step) % LIGHTS.length]
            : `hsl(225 14% ${Math.round(32 + facing * 62)}%)`;
      out.push({
        key: `${band}-${step}`,
        points: [
          corner(lat0, lon0),
          corner(lat0, lon1),
          corner(lat1, lon1),
          corner(lat1, lon0),
        ].join(' '),
        fill,
      });
    }
  }
  return out;
}

const star = (x: number, y: number, r: number) =>
  `M${x} ${y - r} L${x + r * 0.3} ${y - r * 0.3} L${x + r} ${y} L${x + r * 0.3} ${y + r * 0.3} L${x} ${y + r} L${x - r * 0.3} ${y + r * 0.3} L${x - r} ${y} L${x - r * 0.3} ${y - r * 0.3} Z`;

/** A mirrored disco ball on its string, with sparkles: the page's mark, and its badge
 * beside the header logo. With `spin` it turns, unless the visitor asks for less motion */
export default function DiscoBall({
  size = 24,
  spin = false,
  className = '',
}: {
  size?: number;
  spin?: boolean;
  className?: string;
}) {
  const [turn, setTurn] = useState(0);

  useEffect(() => {
    if (!spin || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let frame = 0;
    let last = 0;
    const tick = (time: number) => {
      // About 30 redraws a second is smooth enough, at half the work
      if (time - last > 33) {
        last = time;
        // One full turn every 12 seconds
        setTurn((time / 12000) * Math.PI * 2);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [spin]);

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={`shrink-0 ${className}`}
    >
      <path d="M32 0 V12" stroke="#c9cfdc" strokeWidth="1.5" />
      <rect x="28.5" y="11" width="7" height="5" rx="1" fill="#b58a2a" />
      <circle cx={CX} cy={CY} r={R} fill="#2b3044" />
      {(() => {
        const all = tiles(turn);
        return (
          <>
            {all.map(({ key, points, fill }) => (
              <polygon
                key={key}
                points={points}
                fill={fill}
                stroke="#2b3044"
                strokeWidth="0.5"
                strokeLinejoin="round"
              />
            ))}
          </>
        );
      })()}
      {/* Sparkles thrown off the mirrors */}
      {[
        [8, 18, 4],
        [56, 22, 5],
        [54, 56, 3.5],
        [6, 50, 3],
        [60, 40, 2.5],
        [48, 8, 2.5],
      ].map(([x, y, r]) => (
        <path key={`${x}-${y}`} d={star(x, y, r)} fill="#e9cf8a" />
      ))}
    </svg>
  );
}
