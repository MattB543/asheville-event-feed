import { ImageResponse } from 'next/og';
import { getTodayStringEastern } from '@/lib/utils/timezone';

export const alt = 'Halloween in Asheville: the strangest, spookiest things to do';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
// Drawn fresh each day so the countdown in a shared link stays right
export const revalidate = 3600;

const BAT =
  'M23 9c-2-4-6-6-10-6 2 2 2 5 0 7-3-2-8-2-13 1 4 0 7 3 8 7 3-3 8-4 12-2l3 4 3-4c4-2 9-1 12 2 1-4 4-7 8-7-5-3-10-3-13-1-2-2-2-5 0-7-4 0-8 2-10 6z';
const DRIPS =
  'M0 0H1200V6C1188 6 1186 18 1180 18 1174 18 1172 6 1060 6 1030 6 1028 30 1020 30 1012 30 1010 7 900 7 870 7 868 16 864 16 860 16 858 6 740 6 710 6 708 38 700 38 692 38 690 7 560 7 530 7 528 14 524 14 520 14 518 6 400 6 370 6 368 26 362 26 356 26 354 7 230 7 200 7 198 34 190 34 182 34 180 7 70 7 50 7 48 16 44 16 40 16 38 6 0 6Z';

async function fraunces(): Promise<ArrayBuffer | null> {
  try {
    // Google serves a TTF (which the image renderer can read) to a plain request
    const css = await (
      await fetch('https://fonts.googleapis.com/css2?family=Fraunces:wght@900', {
        signal: AbortSignal.timeout(5000),
      })
    ).text();
    const url = css.match(/url\((https:[^)]+\.ttf)\)/)?.[1];
    if (!url) return null;
    return await (await fetch(url, { signal: AbortSignal.timeout(5000) })).arrayBuffer();
  } catch (error) {
    console.error('[Halloween] Share image font failed, using the default:', error);
    return null;
  }
}

export default async function Image() {
  const today = getTodayStringEastern();
  const halloween = `${today.slice(0, 4)}-10-31`;
  const daysLeft = Math.round(
    (Date.parse(`${halloween}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000
  );
  const countdown =
    daysLeft > 1
      ? `${daysLeft} days until Halloween`
      : daysLeft === 1
        ? '1 day until Halloween'
        : daysLeft === 0
          ? "It's Halloween"
          : null;
  const font = await fraunces();

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        position: 'relative',
        background:
          'radial-gradient(circle at 50% 32%, #2c2a3a 0%, #141320 30%, #07060c 62%, #030712 85%)',
      }}
    >
      <svg
        width="1200"
        height="40"
        viewBox="0 0 1200 40"
        style={{ position: 'absolute', top: 0, left: 0 }}
      >
        <path d={DRIPS} fill="#8a0f1c" />
      </svg>
      <div
        style={{
          position: 'absolute',
          left: 470,
          top: 20,
          width: 260,
          height: 260,
          borderRadius: 130,
          background: 'radial-gradient(circle, rgba(214,232,190,.38) 0%, rgba(214,232,190,0) 70%)',
        }}
      />
      <svg
        width="170"
        height="170"
        viewBox="0 0 150 150"
        style={{ position: 'absolute', left: 515, top: 65 }}
      >
        <circle cx="75" cy="75" r="62" fill="#f4e7c3" />
        <circle cx="98" cy="60" r="11" fill="#e6d7ae" />
        <circle cx="58" cy="96" r="8" fill="#e6d7ae" />
        <circle cx="70" cy="46" r="5" fill="#e6d7ae" />
      </svg>
      <svg
        width="1200"
        height="300"
        viewBox="0 0 1200 300"
        style={{ position: 'absolute', left: 0, top: 40 }}
      >
        <g fill="#1b1a25" opacity="0.9">
          <ellipse cx="300" cy="150" rx="170" ry="34" />
          <ellipse cx="380" cy="128" rx="110" ry="36" />
          <ellipse cx="900" cy="140" rx="180" ry="32" />
          <ellipse cx="820" cy="120" rx="100" ry="34" />
        </g>
        <g fill="#24222f" opacity="0.85">
          <ellipse cx="610" cy="210" rx="170" ry="26" />
          <ellipse cx="560" cy="196" rx="90" ry="26" />
        </g>
        <g fill="#050308" stroke="#a898c4" strokeOpacity="0.55" strokeWidth="1">
          <path d={BAT} transform="translate(440 70) scale(1.6)" />
          <path d={BAT} transform="translate(720 40) scale(1.1)" />
          <path d={BAT} transform="translate(600 150) scale(1.3)" />
        </g>
      </svg>
      <div
        style={{
          marginTop: 300,
          fontSize: 92,
          fontFamily: font ? 'Fraunces' : 'serif',
          fontWeight: 900,
          color: '#fff4e6',
          lineHeight: 1,
        }}
      >
        Halloween in Asheville
      </div>
      <div style={{ marginTop: 20, fontSize: 32, color: '#d6d0e6' }}>
        The strangest, spookiest things to do
      </div>
      {countdown && (
        <div
          style={{
            marginTop: 26,
            display: 'flex',
            padding: '10px 28px',
            borderRadius: 999,
            border: '2px solid rgba(255,138,31,.5)',
            background: 'rgba(255,138,31,.12)',
            fontSize: 30,
            fontWeight: 700,
            color: '#ffd7a8',
          }}
        >
          {countdown}
        </div>
      )}
      <div
        style={{
          position: 'absolute',
          right: 40,
          bottom: 28,
          fontSize: 30,
          fontWeight: 800,
          color: '#ffffff',
        }}
      >
        avlgo.com/halloween
      </div>
    </div>,
    {
      ...size,
      fonts: font ? [{ name: 'Fraunces', data: font, weight: 900, style: 'normal' }] : [],
    }
  );
}
