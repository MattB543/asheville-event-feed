import { ArrowUpRight } from 'lucide-react';
import type { NewsStoryView } from '@/lib/news/queries';
import { outboundUrl, storyAnchorId } from './display';

/**
 * A story that isn't Top: our headline, linking straight to the outlet's
 * article. Nothing else, by design (S19).
 */
export default function NewsStoryRow({ story }: { story: NewsStoryView }) {
  return (
    <li
      id={storyAnchorId(story.shortId)}
      className="scroll-mt-16 transition-colors target:bg-(--accent-warm-soft)"
    >
      {story.lead ? (
        <a
          href={outboundUrl(story.lead.url)}
          target="_blank"
          rel="noopener"
          className="group block px-3 py-2.5 sm:px-5 text-[15px] leading-snug text-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800/60 hover:text-brand-700 dark:hover:text-brand-300 transition-colors"
        >
          {story.headline}
          <ArrowUpRight
            size={13}
            className="ml-1 inline-block -translate-y-px text-gray-400 dark:text-gray-500 group-hover:text-brand-600 dark:group-hover:text-brand-400"
            aria-hidden="true"
          />
        </a>
      ) : (
        <span className="block px-3 py-2.5 sm:px-5 text-[15px] leading-snug text-gray-800 dark:text-gray-200">
          {story.headline}
        </span>
      )}
    </li>
  );
}
