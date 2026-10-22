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

/** The see-through wraith with hollow eyes and an open mouth */
export function Wraith({ width }: { width: number }) {
  return (
    <svg aria-hidden="true" width={width} height={width * (150 / 90)} viewBox="0 0 90 150">
      <defs>
        <linearGradient id="hw-wraith" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#d7e4dc" stopOpacity=".85" />
          <stop offset=".6" stopColor="#b9c9c0" stopOpacity=".45" />
          <stop offset="1" stopColor="#b9c9c0" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        d="M45 6C30 6 22 20 22 38c0 14-6 22-14 30 8-2 12 0 14 4-4 10-10 18-8 30 4-8 10-12 14-12-2 16 2 30 10 44 0-14 4-24 8-30 2 10 8 18 16 26-2-14 0-24 4-32 4 2 8 8 10 14 2-14-2-26-8-34 4-2 8 0 12 2-6-8-10-18-10-30C70 20 60 6 45 6z"
        fill="url(#hw-wraith)"
      />
      <ellipse cx="37" cy="36" rx="5" ry="8" fill="#030712" />
      <ellipse cx="53" cy="36" rx="5" ry="8" fill="#030712" />
      <ellipse cx="45" cy="58" rx="5" ry="11" fill="#030712" opacity=".85" />
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
  return (
    <svg aria-hidden="true" width="40" height={thread + 40} viewBox={`0 0 40 ${thread + 40}`}>
      <path d={`M20 0V${thread}`} stroke="#cbd5e1" strokeWidth="1" opacity=".6" />
      <g transform={`translate(0 ${thread - 150})`}>
        <ellipse cx="20" cy="162" rx="9" ry="11" fill="#1a1024" />
        <circle cx="20" cy="150" r="6" fill="#1a1024" />
        <circle cx="17.5" cy="149" r="1.6" fill={eyes} />
        <circle cx="22.5" cy="149" r="1.6" fill={eyes} />
        <path
          d="M11 156l-9-6M11 162l-10 0M11 168l-9 6M29 156l9-6M29 162l10 0M29 168l9 6"
          stroke="#1a1024"
          strokeWidth="2"
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
    <div aria-hidden="true" className="relative h-[150px]">
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

/** One drip hanging off the end of a word */
export function DripLetter({ children }: { children: string }) {
  return (
    <span className="relative inline-block">
      {children}
      <svg
        aria-hidden="true"
        width="12"
        height="34"
        viewBox="0 0 12 34"
        className="absolute left-1/2 top-[82%] -ml-1.5 origin-top"
        style={{ animation: 'hw-ooze 5s ease-in-out infinite' }}
      >
        <path d="M3 0h6v20q0 5-3 9-3-4-3-9z" fill="#8a0f1c" />
      </svg>
    </span>
  );
}
