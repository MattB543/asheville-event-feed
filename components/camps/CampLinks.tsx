'use client';

import { useEffect, type ReactNode } from 'react';
import { sendCampView } from './campViews';

/** Counts a view of the camp once the page has loaded (01 §4.5). Renders nothing. */
export function CampViewBeacon({ campId }: { campId: string }) {
  useEffect(() => {
    sendCampView(campId);
  }, [campId]);
  return null;
}

/** A link out to the camp's own site; following it counts toward the camp's views. */
export function CampWebsiteLink({
  campId,
  href,
  className,
  children,
}: {
  campId: string;
  href: string;
  className: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => sendCampView(campId)}
      className={className}
    >
      {children}
    </a>
  );
}
