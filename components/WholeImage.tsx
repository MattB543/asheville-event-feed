import Image from 'next/image';

interface WholeImageProps {
  src: string;
  alt: string;
  sizes?: string;
  priority?: boolean;
  referrerPolicy?: React.HTMLAttributeReferrerPolicy;
  onError?: () => void;
}

/**
 * An event image shown whole, never cropped: a tall poster loses its date and venue
 * to object-cover. A blurred copy of the same file fills the box around it. Fills the
 * nearest positioned box.
 */
export default function WholeImage({
  src,
  alt,
  sizes,
  priority,
  referrerPolicy,
  onError,
}: WholeImageProps) {
  const unoptimized = src.startsWith('data:');
  return (
    // The clip keeps iOS Safari from letting the blur spill out and widen the page
    <div className="absolute inset-0 [clip-path:inset(0)]">
      <Image
        src={src}
        alt=""
        aria-hidden
        fill
        sizes={sizes}
        className="object-cover scale-110 blur-2xl brightness-50"
        unoptimized={unoptimized}
        referrerPolicy={referrerPolicy}
      />
      <Image
        src={src}
        alt={alt}
        fill
        sizes={sizes}
        className="object-contain"
        onError={onError}
        unoptimized={unoptimized}
        referrerPolicy={referrerPolicy}
        priority={priority}
      />
    </div>
  );
}
