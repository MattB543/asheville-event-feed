import type { CSSProperties, ReactNode } from 'react';
import { Bat, Cobweb, Spider } from './Decor';

// [left, top, width, opacity, fill, sway, seconds, delay]: clouds drift back and
// forth around the moon rather than across the sky
const CLOUDS: [string, number, number, number, string, 'a' | 'b', number, number][] = [
  ['calc(50% - 300px)', 120, 300, 0.85, '#24222f', 'a', 14, 0],
  ['calc(50% - 40px)', 170, 260, 0.9, '#1b1a25', 'b', 18, -4],
  ['calc(50% - 220px)', 60, 220, 0.55, '#34313f', 'b', 12, -2],
  ['calc(50% + 40px)', 96, 200, 0.7, '#2a2834', 'a', 16, -8],
  ['calc(50% - 140px)', 205, 360, 0.8, '#13121b', 'a', 20, -10],
  ['calc(50% + 120px)', 40, 170, 0.45, '#34313f', 'b', 11, -5],
  ['calc(50% - 460px)', 150, 320, 0.7, '#1b1a25', 'b', 22, -3],
  ['calc(50% + 200px)', 150, 340, 0.75, '#1f1d29', 'a', 19, -12],
  ['calc(50% - 520px)', 40, 260, 0.45, '#2a2834', 'a', 24, -7],
  ['calc(50% + 300px)', 30, 280, 0.5, '#24222f', 'b', 21, -15],
  ['calc(50% - 90px)', 130, 180, 0.55, '#1b1a25', 'b', 9, -1],
  ['calc(50% - 360px)', 240, 420, 0.85, '#0f0e16', 'b', 26, -9],
  ['calc(50% + 160px)', 235, 400, 0.85, '#0f0e16', 'a', 23, -6],
];

// [radius, width, seconds, reverse, delay]: bats circling the moon
const ORBITING_BATS: [number, number, number, boolean, number][] = [
  [120, 40, 16, false, 0],
  [150, 28, 22, true, -6],
  [185, 22, 27, false, -14],
  [100, 32, 19, true, -3],
  [210, 18, 31, false, -20],
];

// [top, width, seconds, reverse, delay]: bats flying straight across its face
const CROSSING_BATS: [number, number, number, boolean, number][] = [
  [140, 44, 9, false, 0],
  [170, 30, 12, true, -5],
  [125, 22, 15, false, -11],
];

const STARS = Array.from({ length: 26 }, (_, i) => ({
  left: `${(i * 37) % 100}%`,
  top: ((i * 53) % 230) + 10,
  size: i % 4 === 0 ? 3 : 2,
  seconds: 2 + (i % 5),
}));

function Cloud({ width, fill }: { width: number; fill: string }) {
  return (
    <svg width={width} height={width / 4} viewBox="0 0 320 80">
      <g fill={fill}>
        <ellipse cx="80" cy="52" rx="80" ry="22" />
        <ellipse cx="150" cy="38" rx="62" ry="28" />
        <ellipse cx="222" cy="52" rx="74" ry="20" />
        <ellipse cx="120" cy="58" rx="90" ry="16" />
      </g>
    </svg>
  );
}

function Layer({ style, children }: { style: CSSProperties; children?: ReactNode }) {
  return (
    <div aria-hidden="true" className="absolute" style={style}>
      {children}
    </div>
  );
}

/** The night sky behind the page title: moon, clouds, bats, fog and mountains */
export default function Sky({ children }: { children: ReactNode }) {
  return (
    <div
      className="relative h-[470px] overflow-hidden sm:h-[500px]"
      style={{
        background:
          'radial-gradient(circle at 50% 30%, #2c2a3a 0, #141320 30%, #07060c 62%, #030712 82%)',
      }}
    >
      {STARS.map((s, i) => (
        <Layer
          key={i}
          style={{
            left: s.left,
            top: s.top,
            width: s.size,
            height: s.size,
            borderRadius: '50%',
            background: '#fff',
            animation: `hw-twinkle ${s.seconds}s ease-in-out infinite`,
          }}
        />
      ))}

      <Layer
        style={{
          left: '50%',
          top: 30,
          width: 260,
          height: 260,
          marginLeft: -130,
          borderRadius: '50%',
          background:
            'radial-gradient(circle, rgba(214,232,190,.38) 0, rgba(180,214,170,.12) 45%, rgba(180,214,170,0) 72%)',
          animation: 'hw-glow 5s ease-in-out infinite',
        }}
      />
      <Layer style={{ left: '50%', top: 80, marginLeft: -80 }}>
        <svg width="160" height="160" viewBox="0 0 150 150">
          <circle cx="75" cy="75" r="62" fill="#f4e7c3" />
          <circle cx="98" cy="60" r="11" fill="#e6d7ae" />
          <circle cx="58" cy="96" r="8" fill="#e6d7ae" />
          <circle cx="70" cy="46" r="5" fill="#e6d7ae" />
          <circle cx="104" cy="98" r="4" fill="#e6d7ae" />
        </svg>
      </Layer>

      {/* Dark wisps passing over the moon's face */}
      {[
        { top: 130, width: 260, height: 46, color: 'rgba(40,38,52,.85)', seconds: 17, delay: 0 },
        { top: 185, width: 220, height: 34, color: 'rgba(28,27,38,.8)', seconds: 23, delay: -9 },
      ].map((v, i) => (
        <Layer
          key={i}
          style={{
            left: `calc(50% - ${v.width / 2}px)`,
            top: v.top,
            width: v.width,
            height: v.height,
            borderRadius: '50%',
            background: `radial-gradient(ellipse, ${v.color} 0, rgba(0,0,0,0) 70%)`,
            animation: `hw-veil ${v.seconds}s ease-in-out infinite ${v.delay}s`,
          }}
        />
      ))}

      {CROSSING_BATS.map(([top, width, seconds, reverse, delay], i) => (
        <Layer
          key={i}
          style={{
            left: 'calc(50% - 20px)',
            top,
            animation: `${reverse ? 'hw-cross-back' : 'hw-cross'} ${seconds}s linear infinite ${delay}s`,
          }}
        >
          <Bat width={width} color="#050308" flap={`${0.24 + i * 0.03}s`} />
        </Layer>
      ))}

      {ORBITING_BATS.map(([radius, width, seconds, reverse, delay], i) => (
        <Layer
          key={i}
          style={{
            left: '50%',
            top: 160,
            width: 0,
            height: 0,
            animation: `${reverse ? 'hw-orbit-back' : 'hw-orbit'} ${seconds}s linear infinite ${delay}s`,
          }}
        >
          <div className="absolute" style={{ left: radius, top: -10 }}>
            <Bat width={width} flap={`${0.25 + i * 0.02}s`} />
          </div>
        </Layer>
      ))}

      {CLOUDS.map(([left, top, width, opacity, fill, sway, seconds, delay], i) => (
        <Layer
          key={i}
          style={{
            left,
            top,
            opacity,
            animation: `hw-hover-${sway} ${seconds}s ease-in-out infinite ${delay}s`,
          }}
        >
          <Cloud width={width} fill={fill} />
        </Layer>
      ))}

      <Layer style={{ left: '7%', top: 0, animation: 'hw-dangle 5s ease-in-out infinite' }}>
        <Spider thread={150} eyes="#ff8a1f" />
      </Layer>
      <Layer style={{ right: '10%', top: 0, animation: 'hw-dangle 6.5s ease-in-out infinite -2s' }}>
        <Spider thread={90} eyes="#b6f36b" />
      </Layer>
      <Cobweb
        size={160}
        style={{ position: 'absolute', left: 0, top: 0, opacity: 0.35, transform: 'scaleX(-1)' }}
      />

      {/* Ridges and fog along the bottom */}
      <svg
        aria-hidden="true"
        width="100%"
        height="130"
        viewBox="0 0 1280 130"
        preserveAspectRatio="none"
        className="absolute bottom-0 left-0"
      >
        <path
          d="M0 76 L120 42 L230 70 L340 32 L470 78 L600 46 L720 70 L860 26 L990 66 L1110 44 L1280 76 V130 H0Z"
          fill="#0d0a18"
        />
        <path
          d="M0 100 L160 70 L300 98 L450 66 L610 100 L760 72 L920 102 L1080 68 L1280 98 V130 H0Z"
          fill="#06040c"
        />
      </svg>
      {[
        { left: '-5%', bottom: 20, width: '60%', height: 70, seconds: 18, delay: 0 },
        { left: '40%', bottom: 10, width: '70%', height: 80, seconds: 24, delay: -8 },
        { left: '15%', bottom: 45, width: '50%', height: 50, seconds: 20, delay: -4 },
      ].map((f, i) => (
        <Layer
          key={i}
          style={{
            left: f.left,
            bottom: f.bottom,
            width: f.width,
            height: f.height,
            borderRadius: '50%',
            background:
              'radial-gradient(ellipse, rgba(170,200,180,.18) 0, rgba(170,200,180,0) 70%)',
            animation: `hw-fog ${f.seconds}s ease-in-out infinite ${f.delay}s`,
          }}
        />
      ))}
      <div
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 h-[70px] bg-gradient-to-t from-[#030712] to-transparent"
      />

      <div className="relative mx-auto max-w-[1180px] px-4 pt-[250px] text-center sm:px-6 sm:pt-[262px]">
        {children}
      </div>
    </div>
  );
}
