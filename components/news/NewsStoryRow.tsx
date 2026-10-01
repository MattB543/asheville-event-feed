import type { NewsStoryView } from '@/lib/news/queries';
import TruncationFlag from './TruncationFlag';
import { outboundUrl, primaryTopic, storyAnchorId, TAP_AREA } from './display';

/**
 * Hovering a cut-off row's headline (desktop): the tag leaves the flow but
 * stays where it was while it fades, so the headline gets its space at once
 * and nothing slides. Hovering the tag itself leaves it clickable.
 */
const FOLD_TAG_ON_HOVER =
  'sm:[li[data-truncated=true]:has([data-row-headline]:hover)_&]:absolute sm:[li[data-truncated=true]:has([data-row-headline]:hover)_&]:right-5 sm:[li[data-truncated=true]:has([data-row-headline]:hover)_&]:top-2.5 sm:[li[data-truncated=true]:has([data-row-headline]:hover)_&]:opacity-0 sm:[li[data-truncated=true]:has([data-row-headline]:hover)_&]:pointer-events-none';

/**
 * A story that isn't Top: our headline, with the whole row linking straight
 * to the outlet's article, and its topic tag at the right. From sm up the
 * row stays one line and a long headline is cut off with an ellipsis;
 * hovering a cut-off headline hides the tag to show the rest. Nothing else
 * (S19).
 */
export default function NewsStoryRow({ story }: { story: NewsStoryView }) {
  const topic = primaryTopic(story.topics);

  return (
    <li
      id={storyAnchorId(story.shortId)}
      className="group relative flex items-start scroll-mt-16 px-3 py-2.5 sm:px-5 text-[15px] leading-snug hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors"
    >
      <TruncationFlag />
      <div className="min-w-0 flex-1">
        {story.lead ? (
          // The link's ::after covers the row, so the whole row clicks through;
          // the tag comes later in the markup and sits above it.
          <a
            href={outboundUrl(story.lead.url)}
            target="_blank"
            rel="noopener"
            data-row-headline
            className="block sm:truncate text-gray-800 dark:text-gray-200 group-hover:text-brand-700 dark:group-hover:text-brand-300 transition-colors after:absolute after:inset-0 after:content-['']"
          >
            {story.headline}
          </a>
        ) : (
          <span data-row-headline className="block text-gray-800 dark:text-gray-200 sm:truncate">
            {story.headline}
          </span>
        )}
      </div>
      {topic && (
        <a
          href={`/news?topic=${topic.slug}`}
          className={`${TAP_AREA} ml-3 shrink-0 whitespace-nowrap rounded border border-gray-200 dark:border-gray-700 px-1.5 text-[11px] leading-[18px] text-gray-500 dark:text-gray-400 hover:border-brand-500 hover:text-brand-700 dark:hover:text-brand-300 transition-opacity duration-75 ${FOLD_TAG_ON_HOVER}`}
        >
          {topic.label}
        </a>
      )}
    </li>
  );
}
