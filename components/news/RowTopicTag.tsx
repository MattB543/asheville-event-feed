'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { TAP_AREA } from './display';

/** Distinct line tops of an inline element, i.e. how many lines it wraps to. */
function lineCount(element: Element): number {
  return new Set([...element.getClientRects()].map((rect) => Math.round(rect.top))).size;
}

/**
 * A "More news" row's topic tag, at the right of the row. It's left out when
 * making room for it would wrap the headline onto another line. It starts
 * hidden and appears once measured, so rows never jump.
 */
export default function RowTopicTag({ slug, label }: { slug: string; label: string }) {
  const ref = useRef<HTMLAnchorElement>(null);
  const [fits, setFits] = useState(false);

  useLayoutEffect(() => {
    const tag = ref.current;
    const row = tag?.parentElement;
    const headline = row?.querySelector('[data-row-headline]');
    if (!tag || !row || !headline) return;

    const measure = () => {
      tag.style.display = 'none';
      const without = lineCount(headline);
      tag.style.display = 'inline-block';
      const withTag = lineCount(headline);
      tag.style.display = '';
      setFits(withTag <= without);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  }, []);

  return (
    <a
      ref={ref}
      href={`/news?topic=${slug}`}
      className={`${TAP_AREA} ${fits ? 'inline-block' : 'hidden'} shrink-0 whitespace-nowrap rounded border border-gray-200 dark:border-gray-700 px-1.5 text-[11px] leading-5 text-gray-500 dark:text-gray-400 hover:border-brand-500 hover:text-brand-700 dark:hover:text-brand-300 transition-colors`}
    >
      {label}
    </a>
  );
}
