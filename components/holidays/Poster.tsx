'use client';

import { useState } from 'react';
import Image from 'next/image';

interface PosterProps {
  src: string | null;
  title: string;
  when?: string;
  venue?: string;
  sizes: string;
  /** Title size on the stand-in flyer */
  flyerTextClass: string;
  /** The holiday's look for the stand-in flyer: its title font and colours, and its background */
  flyerTitleClass?: string;
  flyerBackground?: string;
}

/**
 * The event's poster at its own shape, or a homemade flyer when it has
 * none or the image won't load (expired Facebook links, sites that block us).
 */
export default function Poster({
  src,
  title,
  when,
  venue,
  sizes,
  flyerTextClass,
  flyerTitleClass = 'font-bold text-gray-100',
  flyerBackground = 'linear-gradient(160deg, #374151, #111827)',
}: PosterProps) {
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
        className="block h-auto w-full bg-gray-900"
        onError={() => setFailedSrc(src)}
      />
    );
  }
  return (
    <div
      data-flyer
      className="flex aspect-[3/4] flex-col items-center justify-center gap-2.5 p-4 text-center"
      style={{ background: flyerBackground }}
    >
      <span className={`leading-[1.05] tracking-wide ${flyerTitleClass} ${flyerTextClass}`}>
        {title}
      </span>
      {when && (
        <span className="text-xs font-bold uppercase tracking-[.14em] text-white/80">{when}</span>
      )}
      {venue && <span className="text-[13px] text-white/65">{venue}</span>}
    </div>
  );
}
