'use client';

import Fir from './Fir';
import Snowfall from './Snowfall';
import { setSnow, stopAllSnow, useSnowing } from './snow';

/** The hidden one: tapping the tree lights it up and starts the snow; another tap stops it */
export default function SnowyFir() {
  const snowing = useSnowing();
  return (
    <>
      <button
        type="button"
        onClick={() => (snowing ? stopAllSnow() : setSnow('tree', true))}
        aria-label={snowing ? 'Stop the snow' : 'Let it snow'}
        aria-pressed={snowing}
        className={`xmas-tree mx-auto block cursor-pointer rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#e7c873] ${snowing ? 'xmas-lit' : ''}`}
      >
        <Fir size={72} />
      </button>
      <Snowfall falling={snowing} />
    </>
  );
}
