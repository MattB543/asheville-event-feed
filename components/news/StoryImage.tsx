'use client';

import { useEffect, useRef, useState } from 'react';

interface StoryImageProps {
  src: string;
  className?: string;
}

/** Drops the whole frame, so a dead image leaves no empty box behind. */
function hideFrame(img: HTMLImageElement) {
  if (img.parentElement) img.parentElement.style.display = 'none';
}

function isPortrait(img: HTMLImageElement) {
  return img.naturalHeight > img.naturalWidth;
}

/**
 * The lead article's photo, hot-linked from the outlet: a plain <img> (no
 * Next optimizer, which would fetch it server-side), sent with no referrer,
 * and gone entirely if it fails to load. A portrait photo in the 16:9 frame
 * is cropped from near its top, where the faces usually are.
 */
export default function StoryImage({ src, className = '' }: StoryImageProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [portrait, setPortrait] = useState(false);

  // An image that settled before hydration fired its load or error event
  // before React was listening, so check once on mount as well.
  useEffect(() => {
    const img = imgRef.current;
    if (!img?.complete) return;
    if (img.naturalWidth === 0) hideFrame(img);
    else setPortrait(isPortrait(img));
  }, []);

  return (
    <div
      className={`aspect-video overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-800 ${className}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onLoad={(event) => setPortrait(isPortrait(event.currentTarget))}
        onError={(event) => hideFrame(event.currentTarget)}
        className={`h-full w-full object-cover ${portrait ? 'object-[50%_20%]' : ''}`}
      />
    </div>
  );
}
