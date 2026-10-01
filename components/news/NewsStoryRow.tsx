import { ArrowUpRight } from 'lucide-react';
import type { NewsStoryView } from '@/lib/news/queries';
import { outboundUrl, primaryTopic, storyAnchorId, TAP_AREA } from './display';

/**
 * A story that isn't Top: our headline, linking straight to the outlet's
 * article, then its topic tag. Nothing else (S19).
 */
export default function NewsStoryRow({ story }: { story: NewsStoryView }) {
  const topic = primaryTopic(story.topics);

  return (
    <li
      id={storyAnchorId(story.shortId)}
      className="scroll-mt-16 px-3 py-2.5 sm:px-5 text-[15px] leading-snug"
    >
      {story.lead ? (
        <a
          href={outboundUrl(story.lead.url)}
          target="_blank"
          rel="noopener"
          className="group text-gray-800 dark:text-gray-200 hover:text-brand-700 dark:hover:text-brand-300 transition-colors"
        >
          {story.headline}
          <ArrowUpRight
            size={13}
            className="ml-1 inline-block -translate-y-px text-gray-400 dark:text-gray-500 group-hover:text-brand-600 dark:group-hover:text-brand-400"
            aria-hidden="true"
          />
        </a>
      ) : (
        <span className="text-gray-800 dark:text-gray-200">{story.headline}</span>
      )}
      {topic && (
        <a
          href={`/news?topic=${topic.slug}`}
          className={`${TAP_AREA} ml-2 inline-block whitespace-nowrap rounded border border-gray-200 dark:border-gray-700 px-1.5 align-[1px] text-[11px] leading-5 text-gray-500 dark:text-gray-400 hover:border-brand-500 hover:text-brand-700 dark:hover:text-brand-300 transition-colors`}
        >
          {topic.label}
        </a>
      )}
    </li>
  );
}
