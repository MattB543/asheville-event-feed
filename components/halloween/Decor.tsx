import type { CSSProperties } from 'react';

// Hand-drawn Halloween pieces, all decoration: hidden from screen readers

const BAT_PATH =
  'M23 9c-2-4-6-6-10-6 2 2 2 5 0 7-3-2-8-2-13 1 4 0 7 3 8 7 3-3 8-4 12-2l3 4 3-4c4-2 9-1 12 2 1-4 4-7 8-7-5-3-10-3-13-1-2-2-2-5 0-7-4 0-8 2-10 6z';
const SPECTER_PATH =
  'M40 4C26 4 18 16 16 32L4 70c6-2 10 0 12 4l-2 40c6 10 8 26 6 42 6-12 10-20 14-24 2 10 4 18 10 24 2-10 4-18 8-24 4 6 8 14 10 22 0-16 2-30 8-40l-2-40c2-4 6-6 12-4L64 32C62 16 54 4 40 4z';
const COBWEB_LINES = 'M90 0L20 70M90 0L0 40M90 0L50 90M90 0L2 4';
const COBWEB_RINGS = 'M74 0Q76 15 90 16M56 0Q60 30 90 34M36 0Q44 50 90 56M16 1Q30 68 90 78';

export function Pumpkin({ size, glow = false }: { size: number; glow?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 64 64"
      style={glow ? { filter: 'drop-shadow(0 0 10px rgba(255,160,40,.55))' } : undefined}
    >
      <path
        d="M32 14c0-6 3-9 7-10"
        stroke="#5a7a2c"
        strokeWidth="4"
        fill="none"
        strokeLinecap="round"
      />
      <path d="M39 6q8-2 10 5" stroke="#5a7a2c" strokeWidth="2" fill="none" />
      <ellipse cx="18" cy="38" rx="14" ry="20" fill="#d9620f" />
      <ellipse cx="46" cy="38" rx="14" ry="20" fill="#d9620f" />
      <ellipse cx="32" cy="38" rx="14" ry="22" fill="#ff8a1f" />
      <path
        className="hw-flicker"
        d="M18 29l7 7H13zM46 29l-7 7h12zM32 38l3 5h-6zM16 46q16 11 32 0l-5 3-3-3-4 4-4-4-4 4-4-4-3 3z"
        fill="#ffd34d"
      />
    </svg>
  );
}

export function Bat({
  width,
  color = '#07040d',
  flap = '0.3s',
}: {
  width: number;
  color?: string;
  flap?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      width={width}
      height={width / 2}
      viewBox="0 0 46 22"
      className="hw-flap"
      style={{ animationDuration: flap }}
    >
      <path d={BAT_PATH} fill={color} />
    </svg>
  );
}

/** A hooded, fading figure with a dark face */
export function Specter({ width, eyes = true }: { width: number; eyes?: boolean }) {
  return (
    <svg aria-hidden="true" width={width} height={width * 2} viewBox="0 0 80 160">
      <defs>
        <linearGradient id="hw-specter" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#cfd8e3" stopOpacity=".7" />
          <stop offset=".7" stopColor="#9aa8b8" stopOpacity=".3" />
          <stop offset="1" stopColor="#9aa8b8" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={SPECTER_PATH} fill="url(#hw-specter)" />
      <path d="M24 30q16-14 32 0v18q-16 8-32 0z" fill="#030712" opacity=".92" />
      {eyes && (
        <>
          <circle cx="33" cy="38" r="2" fill="#c7f0d8" />
          <circle cx="47" cy="38" r="2" fill="#c7f0d8" />
        </>
      )}
    </svg>
  );
}

/** The plain sheet ghost that bobs over the footer */
export function SheetGhost({ size }: { size: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size * 1.1} viewBox="0 0 44 52">
      <path
        d="M22 4c-10 0-17 8-17 19v24l5-4 4 4 4-4 4 4 4-4 4 4 4-4 5 4V23c0-11-7-19-17-19z"
        fill="#eeeaf6"
      />
      <circle cx="16" cy="21" r="2.6" fill="#030712" />
      <circle cx="28" cy="21" r="2.6" fill="#030712" />
    </svg>
  );
}

export function Cobweb({ size, style }: { size: number; style?: CSSProperties }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 90 90" style={style}>
      <g stroke="#cbd5e1" strokeWidth=".8" fill="none">
        <path d={COBWEB_LINES} />
        <path d={COBWEB_RINGS} />
      </g>
    </svg>
  );
}

export function Spider({ thread, eyes }: { thread: number; eyes: string }) {
  // Legs bend up at the knee and down to the tip, so it reads as a spider, not a bug
  const legs = [
    'M22 10 L10 -4 L-2 6',
    'M21 14 L6 4 L-6 16',
    'M21 18 L6 18 L-4 32',
    'M22 22 L10 30 L2 44',
  ];
  return (
    <svg aria-hidden="true" width="56" height={thread + 56} viewBox={`0 0 56 ${thread + 56}`}>
      <path d={`M28 0V${thread}`} stroke="#cbd5e1" strokeWidth="0.8" opacity=".5" />
      <g transform={`translate(0 ${thread - 2})`}>
        {legs.map((d) => (
          <g
            key={d}
            stroke="#3a2c48"
            strokeWidth="2.2"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d={d} />
            <path d={d} transform="translate(56 0) scale(-1 1)" />
          </g>
        ))}
        {legs.map((d) => (
          <g key={`rim-${d}`} stroke="#8a77a6" strokeWidth="0.6" fill="none" opacity=".7">
            <path d={d} />
            <path d={d} transform="translate(56 0) scale(-1 1)" />
          </g>
        ))}
        <ellipse cx="28" cy="34" rx="11" ry="14" fill="#120a18" stroke="#7d6a96" strokeWidth="1" />
        <ellipse cx="24" cy="28" rx="3" ry="5" fill="#ffffff" opacity=".12" />
        <path d="M25 30h6l-2.2 4 2.2 4h-6l2.2-4z" fill="#c0101c" />
        <ellipse cx="28" cy="15" rx="7" ry="7.5" fill="#1a1022" stroke="#7d6a96" strokeWidth="1" />
        {[
          [25, 13, 1.4],
          [31, 13, 1.4],
          [26.5, 10.5, 0.9],
          [29.5, 10.5, 0.9],
          [23.5, 15.5, 0.8],
          [32.5, 15.5, 0.8],
        ].map(([cx, cy, r]) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} fill={eyes} />
        ))}
        <path
          d="M25.5 21.5l1 4M30.5 21.5l-1 4"
          stroke="#d9d0e6"
          strokeWidth="1.2"
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}

/** Glowing eyes that open, blink and vanish in the dark */
export function Eyes({ color, style }: { color: string; style: CSSProperties }) {
  const eye = {
    width: 8,
    height: 5,
    borderRadius: '50%',
    background: color,
    boxShadow: `0 0 10px 3px ${color}`,
  };
  return (
    <div aria-hidden="true" className="hw-float flex gap-[9px]" style={style}>
      <span style={eye} />
      <span style={eye} />
    </div>
  );
}

/** A skull between two candles, between the page's two sections */
export function SkullDivider() {
  return (
    <div aria-hidden="true" className="flex items-end justify-center gap-5">
      <span className="mb-[18px] h-px flex-[0_1_260px] bg-gradient-to-r from-violet-400/0 to-violet-400/60" />
      <Candle flame={2} />
      <svg width="56" height="56" viewBox="0 0 56 56">
        <path
          d="M28 4C15 4 6 13 6 25c0 7 3 12 8 15v8h28v-8c5-3 8-8 8-15C50 13 41 4 28 4z"
          fill="#e9e4d4"
        />
        <ellipse cx="19" cy="26" rx="6" ry="7" fill="#030712" />
        <ellipse cx="37" cy="26" rx="6" ry="7" fill="#030712" />
        <circle className="hw-flicker" cx="19" cy="27" r="1.6" fill="#ff8a1f" />
        <circle
          className="hw-flicker"
          cx="37"
          cy="27"
          r="1.6"
          fill="#ff8a1f"
          style={{ animationDelay: '-1s' }}
        />
        <path d="M28 33l-3 6h6z" fill="#030712" />
        <path d="M18 44v4M23 44v4M28 44v4M33 44v4M38 44v4" stroke="#030712" strokeWidth="2" />
      </svg>
      <Candle flame={6} />
      <span className="mb-[18px] h-px flex-[0_1_260px] bg-gradient-to-r from-violet-400/60 to-violet-400/0" />
    </div>
  );
}

function Candle({ flame }: { flame: number }) {
  return (
    <svg width="16" height="44" viewBox="0 0 16 44">
      <path className="hw-flicker" d={`M8 ${flame}q5 6 0 12q-5-6 0-12z`} fill="#ffb347" />
      <rect x="3" y={flame + 14} width="10" height={30 - flame} rx="2" fill="#e8e1d0" />
    </svg>
  );
}

/** Tombstones, a broken fence and a pumpkin patch above the footer */
export function Graveyard() {
  return (
    <div aria-hidden="true" className="relative h-[150px] overflow-hidden">
      <GraveHand style={{ left: '62%', bottom: 26 }} />
      <svg
        width="100%"
        height="150"
        viewBox="0 0 1280 150"
        preserveAspectRatio="xMidYMax meet"
        className="absolute bottom-0 left-0"
      >
        <path d="M0 150V118Q320 96 640 112T1280 108V150Z" fill="#0b0814" />
        <g fill="#2a2d36" stroke="#3d414d" strokeWidth="2">
          <path d="M180 122V78Q180 56 205 56Q230 56 230 78V122Z" />
          <path d="M300 120V92H286V80H300V66H314V80H328V92H314V120Z" />
          <path d="M930 116V70Q930 48 958 48Q986 48 986 70V116Z" />
          <path d="M1060 118V90Q1060 76 1076 76Q1092 76 1092 90V118Z" />
        </g>
        <path
          d="M420 124V84M450 122V80M480 124V86M510 122V82M540 124V88M410 98H550"
          stroke="#1b1424"
          strokeWidth="5"
          strokeLinecap="round"
        />
        <g transform="translate(680 84)">
          <svg width="44" height="44" viewBox="0 0 64 64">
            <ellipse cx="18" cy="38" rx="14" ry="20" fill="#d9620f" />
            <ellipse cx="46" cy="38" rx="14" ry="20" fill="#d9620f" />
            <ellipse cx="32" cy="38" rx="14" ry="22" fill="#ff8a1f" />
            <path
              d="M18 29l7 7H13zM46 29l-7 7h12zM16 46q16 11 32 0l-5 3-3-3-4 4-4-4-4 4-4-4-3 3z"
              fill="#ffd34d"
            />
          </svg>
        </g>
        <g transform="translate(758 102)">
          <ellipse cx="0" cy="14" rx="13" ry="10" fill="#d9620f" />
          <ellipse cx="0" cy="14" rx="7" ry="11" fill="#ff8a1f" />
          <path d="M0 4q0-4 3-5" stroke="#5a7a2c" strokeWidth="2.4" fill="none" />
        </g>
      </svg>
    </div>
  );
}

/** Blood dripping from the bottom of the site header, a drop now and then falling */
export function BloodDrips() {
  const drop = (left: string, top: number, delay: string, size: number) => (
    <span
      className="absolute"
      style={{
        left,
        top,
        width: size,
        height: size * 1.4,
        borderRadius: '50% 50% 50% 50% / 60% 60% 40% 40%',
        background: '#8a0f1c',
        animation: `hw-drip 5s ease-in infinite ${delay}`,
      }}
    />
  );
  return (
    <div aria-hidden="true" className="relative z-[6] h-0">
      <svg
        width="100%"
        height="34"
        viewBox="0 0 1280 34"
        preserveAspectRatio="none"
        className="absolute left-0 top-0"
      >
        <path
          d="M0 0H1280V3C1268 3 1266 12 1262 12 1258 12 1257 4 1190 4 1150 4 1148 22 1142 22 1136 22 1135 5 1020 5 980 5 978 14 974 14 970 14 969 4 860 4 830 4 828 28 821 28 814 28 813 5 700 5 660 5 659 11 655 11 651 11 650 4 520 4 490 4 488 18 483 18 478 18 477 5 360 5 330 5 329 9 326 9 323 9 322 4 210 4 180 4 178 25 172 25 166 25 165 5 60 5 40 5 39 13 36 13 33 13 32 3 0 3Z"
          fill="#8a0f1c"
        />
      </svg>
      {drop('calc(64.1% - 3px)', 26, '0s', 7)}
      {drop('calc(13.4% - 3px)', 23, '-2.5s', 6)}
    </div>
  );
}

/** Blood running off the bottom of a letter, a drop now and then falling from it */
export function DripLetter({ children }: { children: string }) {
  return (
    <span className="relative inline-block">
      {children}
      <span
        aria-hidden="true"
        className="absolute left-1/2 top-[86%] -ml-[7px] block h-[46px] w-[14px]"
      >
        <svg
          width="14"
          height="34"
          viewBox="0 0 14 34"
          className="block origin-top"
          style={{ animation: 'hw-ooze 5s ease-in-out infinite' }}
        >
          <path
            d="M1 0h12c-2 3-3 6-3.5 11-.4 4-.3 8 .9 11.5A3.9 3.9 0 0 1 7 28a3.9 3.9 0 0 1-3.4-5.5C4.8 19 4.9 15 4.5 11 4 6 3 3 1 0z"
            fill="#9b111e"
          />
          <ellipse cx="5.6" cy="22" rx="0.9" ry="2" fill="#e05a66" opacity=".7" />
        </svg>
        <span
          className="absolute left-1/2 top-[26px] -ml-[3px] block h-[8px] w-[6px]"
          style={{
            borderRadius: '50% 50% 50% 50% / 60% 60% 40% 40%',
            background: '#9b111e',
            animation: 'hw-drip 5s ease-in infinite -1s',
          }}
        />
      </span>
    </span>
  );
}

/** A raven that crosses now and then */
export function Raven({ style }: { style: CSSProperties }) {
  return (
    <div aria-hidden="true" className="absolute" style={style}>
      <svg
        width="70"
        height="34"
        viewBox="0 0 70 34"
        className="hw-flap"
        style={{ animationDuration: '0.45s' }}
      >
        <path
          d="M35 14c-6-8-18-12-35-8 12 2 20 8 24 14-6 0-10 2-12 5 8-2 14-1 18 2l5 5 3-3c2 0 6 1 9 3-1-3-3-5-6-6 4-2 8-6 10-12-7 4-12 5-16 4 4-4 10-8 30-10-14-3-25 0-30 6z"
          fill="#07040a"
        />
        <circle cx="38" cy="20" r="1.2" fill="#ffcf3b" />
      </svg>
    </div>
  );
}

/** A witch on a broom, a silhouette like the bats */
export function Witch({ style }: { style: CSSProperties }) {
  return (
    <div aria-hidden="true" className="absolute" style={style}>
      <svg width="76" height="44" viewBox="0 0 70 40">
        <path d="M0 30 L48 22" stroke="#07040a" strokeWidth="2.4" />
        <path d="M48 22 l18 -6 -2 8 4 6 -18 -2z" fill="#07040a" />
        <path d="M22 26l4-14 6 0 2 12z" fill="#07040a" />
        <path d="M24 12l5-12 4 12z" fill="#07040a" />
        <path d="M18 12h20" stroke="#07040a" strokeWidth="3" />
      </svg>
    </div>
  );
}

/** Sparks drifting up off a pumpkin or a flame */
export function Embers({ style }: { style: CSSProperties }) {
  return (
    <div aria-hidden="true" className="hw-float" style={style}>
      {[
        [0, 2.4, 0, 4],
        [8, 3, -1, 3],
        [-6, 2.1, -1.6, 3],
      ].map(([x, seconds, delay, size]) => (
        <span
          key={x}
          className="absolute rounded-full"
          style={{
            left: x,
            width: size,
            height: size,
            background: '#ffb347',
            boxShadow: '0 0 6px 2px #ff7a00',
            animation: `hw-ember ${seconds}s ease-out infinite ${delay}s`,
          }}
        />
      ))}
    </div>
  );
}

/** A dead leaf tumbling down the page */
export function Leaf({ style, color }: { style: CSSProperties; color: string }) {
  return (
    <div aria-hidden="true" className="hw-float" style={style}>
      <svg width="18" height="18" viewBox="0 0 20 20">
        <path d="M10 0C4 4 2 10 10 20 18 10 16 4 10 0z" fill={color} />
        <path d="M10 2v17" stroke="#3a1a08" strokeWidth=".8" />
      </svg>
    </div>
  );
}

/** A flock that bursts out and scatters every so often */
export function BatSwarm({ style }: { style: CSSProperties }) {
  return (
    <div aria-hidden="true" className="hw-float" style={style}>
      {Array.from({ length: 9 }, (_, i) => {
        const angle = (i / 9) * Math.PI * 2;
        return (
          <div
            key={i}
            className="absolute"
            style={
              {
                '--dx': `${Math.round(Math.cos(angle) * 180)}px`,
                '--dy': `${Math.round(Math.sin(angle) * 110)}px`,
                animation: `hw-burst 12s ease-out infinite -${(i % 3) * 0.15}s`,
              } as CSSProperties
            }
          >
            <svg
              width="22"
              height="11"
              viewBox="0 0 46 22"
              className="hw-flap"
              style={{ animationDuration: '0.25s' }}
            >
              <path d={BAT_PATH} fill="#4a3a5e" stroke="#8a77a6" strokeWidth="1" />
            </svg>
          </div>
        );
      })}
    </div>
  );
}

/** Lit candles hanging in the air */
export function FloatingCandles({ style }: { style: CSSProperties }) {
  return (
    <div aria-hidden="true" className="hw-float flex gap-6" style={style}>
      {[0, 22, 6].map((drop, i) => (
        <div
          key={i}
          style={{ marginTop: drop, animation: `hw-candle ${4 + i * 0.6}s ease-in-out infinite` }}
        >
          <svg width="14" height="46" viewBox="0 0 16 50">
            <path
              d="M8 2q5 7 0 13q-5-6 0-13z"
              fill="#ffb347"
              style={{
                animation: 'hw-flame 1.4s ease-in-out infinite',
                transformOrigin: '8px 14px',
              }}
            />
            <rect x="3" y="16" width="10" height="34" rx="2" fill="#e8e1d0" />
          </svg>
        </div>
      ))}
    </div>
  );
}

/** A skeletal hand that rises out of the ground, then sinks back */
export function GraveHand({ style }: { style: CSSProperties }) {
  return (
    <div
      aria-hidden="true"
      className="absolute overflow-hidden"
      style={{ width: 54, height: 90, ...style }}
    >
      <svg
        width="54"
        height="90"
        viewBox="0 0 54 90"
        style={{ animation: 'hw-hand 14s ease-in-out infinite' }}
      >
        <path
          d="M18 90V48l-8-22a3 3 0 0 1 5-2l7 16V12a3 3 0 0 1 6 0v26l2-30a3 3 0 0 1 6 0l-1 30 4-24a3 3 0 0 1 6 1l-4 28 5-14a3 3 0 0 1 5 2l-7 26v35z"
          fill="#cfd6c8"
          stroke="#6b7466"
          strokeWidth="1.2"
        />
        <path d="M24 60h12M23 70h14" stroke="#6b7466" strokeWidth="1" />
      </svg>
    </div>
  );
}

/** A spider walking along the top edge of whatever it sits on */
export function CrawlingSpider() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 -top-[18px] z-[5] overflow-hidden h-6"
    >
      <div style={{ animation: 'hw-crawl 22s linear infinite' }}>
        <svg width="40" height="24" viewBox="0 0 40 24">
          <g
            stroke="#3a2c48"
            strokeWidth="2"
            fill="none"
            style={{ animation: 'hw-legs 0.3s ease-in-out infinite', transformOrigin: '20px 14px' }}
          >
            <path d="M14 12L6 4 0 10M14 14L4 12 0 20M26 12L34 4 40 10M26 14L36 12 40 20" />
          </g>
          <ellipse cx="20" cy="14" rx="8" ry="6" fill="#120a18" stroke="#7d6a96" />
          <circle cx="27" cy="13" r="1.2" fill="#ff2b2b" />
        </svg>
      </div>
    </div>
  );
}

/** Mist rolling slowly along the bottom of a section */
export function LowFog() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 bottom-0 h-40 overflow-hidden"
    >
      {[
        { left: '-10%', width: '70%', seconds: 16, delay: 0 },
        { left: '35%', width: '75%', seconds: 21, delay: -7 },
      ].map((f) => (
        <div
          key={f.left}
          className="absolute bottom-0 h-28 rounded-[50%]"
          style={{
            left: f.left,
            width: f.width,
            background:
              'radial-gradient(ellipse, rgba(190,210,200,.22) 0, rgba(190,210,200,0) 70%)',
            animation: `hw-fog ${f.seconds}s ease-in-out infinite ${f.delay}s`,
          }}
        />
      ))}
    </div>
  );
}
