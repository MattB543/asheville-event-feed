'use client';

import type { ComponentProps } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

type IntentLinkProps = Omit<ComponentProps<typeof Link>, 'href' | 'prefetch'> & {
  href: string;
  /** Off for links a plain click doesn't follow (e.g. a card that opens the event modal) */
  prefetchOnIntent?: boolean;
};

/**
 * A Link that prefetches on hover, focus or touch instead of when it scrolls into view, for
 * links to dynamic pages, where a viewport prefetch costs a server render per link in view.
 * (`prefetch={false}` alone also turns off Next's hover prefetch.)
 */
export default function IntentLink({
  href,
  prefetchOnIntent = true,
  onMouseEnter,
  onFocus,
  onTouchStart,
  ...props
}: IntentLinkProps) {
  const router = useRouter();
  const prefetch = () => {
    if (prefetchOnIntent) router.prefetch(href);
  };

  return (
    <Link
      {...props}
      href={href}
      prefetch={false}
      onMouseEnter={(e) => {
        onMouseEnter?.(e);
        prefetch();
      }}
      onFocus={(e) => {
        onFocus?.(e);
        prefetch();
      }}
      onTouchStart={(e) => {
        onTouchStart?.(e);
        prefetch();
      }}
    />
  );
}
