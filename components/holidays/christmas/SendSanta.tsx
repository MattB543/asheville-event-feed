'use client';

import { sendFlyby } from '@/components/seasonal/SeasonalLinks';

/** Admins only: send Santa's sleigh across the header now, instead of waiting for it */
export default function SendSanta() {
  return (
    <button
      type="button"
      onClick={() => sendFlyby('christmas')}
      className="mx-auto mt-5 block cursor-pointer rounded-full border border-[#e7c873]/50 px-4 py-1.5 text-sm font-semibold text-[#e7c873] hover:bg-white/10"
    >
      Send Santa
    </button>
  );
}
