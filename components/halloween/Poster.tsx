'use client';

import { useState } from 'react';
import Image from 'next/image';
import { creepster } from './fonts';

interface PosterProps {
  src: string | null;
  title: string;
  when?: string;
  venue?: string;
  sizes: string;
  /** Title size on the stand-in flyer */
  flyerTextClass: string;
}

/**
 * The event's poster at its own shape, or a homemade spooky flyer when it has
 * none or the image won't load (expired Facebook links, sites that block us).
 */
export default function Poster({ src, title, when, venue, sizes, flyerTextClass }: PosterProps) {
  // Kept per src, so a replacement poster (an admin upload) gets its own try
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (src && src !== failedSrc) {
    return (
      <Image
        src={src}
        alt={`${title} poster`}
        width={480}
        height={640}
        sizes={sizes}
        className="block h-auto w-full bg-[#140b1f]"
        onError={() => setFailedSrc(src)}
      />
    );
  }
  return (
    <div
      className="flex aspect-[3/4] flex-col items-center justify-center gap-2.5 p-4 text-center"
      style={{ background: 'radial-gradient(circle at 50% 35%, #2b1640, #0a0610 75%)' }}
    >
      <span
        className={`${creepster.className} leading-[1.05] tracking-wide text-[#ff9a3c] ${flyerTextClass}`}
      >
        {title}
      </span>
      {when && (
        <span className="text-xs font-bold uppercase tracking-[.14em] text-[#d9c8ff]">{when}</span>
      )}
      {venue && <span className="text-[13px] text-[#b7aecb]">{venue}</span>}
    </div>
  );
}
