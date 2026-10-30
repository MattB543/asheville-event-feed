'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

/** The directory's filters as URL parameters, saved for this tab by CampDirectory. */
export const CAMPS_LIST_KEY = 'camps:list';

/** "All camps", back to the directory with the filters this tab last had there. */
export default function BackToCamps() {
  const [href, setHref] = useState('/camps');

  useEffect(() => {
    try {
      const list = sessionStorage.getItem(CAMPS_LIST_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- SSR hydration: can't read sessionStorage during server render
      if (list) setHref(`/camps?${list}`);
    } catch {
      // Blocked storage: the plain directory.
    }
  }, []);

  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-brand-600 dark:hover:text-brand-400 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
    >
      <ArrowLeft size={16} aria-hidden="true" />
      All camps
    </Link>
  );
}
