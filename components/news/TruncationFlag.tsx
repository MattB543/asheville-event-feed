'use client';

import { useEffect, useRef } from 'react';

/**
 * Marks its "More news" row `data-truncated` when the headline is cut off, so
 * the row's CSS can fold the topic tag away on hover and show the whole
 * headline. Renders nothing visible.
 */
export default function TruncationFlag() {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const row = ref.current?.closest('li');
    const headline = row?.querySelector<HTMLElement>('[data-row-headline]');
    if (!row || !headline) return;

    const measure = () => {
      // While hovered the tag is folded away, so the headline would measure as fitting
      if (row.matches(':hover')) return;
      row.dataset.truncated = String(headline.scrollWidth > headline.clientWidth);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  }, []);

  return <span ref={ref} hidden />;
}
