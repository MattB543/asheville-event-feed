import { ArrowUpRight } from 'lucide-react';
import type { NewsStoryView } from '@/lib/news/queries';
import OtherSourcesMenu from './OtherSourcesMenu';
import RowTopicTag from './RowTopicTag';
import { outboundUrl, primaryTopic, storyAnchorId } from './display';

/**
 * A story that isn't Top: our headline, with the whole row linking straight
 * to the outlet's article, a caret listing its other outlets when it has
 * any, and its topic tag at the right if that doesn't wrap the headline.
 * Nothing else (S19).
 */
export default function NewsStoryRow({ story }: { story: NewsStoryView }) {
  const topic = primaryTopic(story.topics);

  return (
    <li
      id={storyAnchorId(story.shortId)}
      className="group relative flex items-start gap-3 scroll-mt-16 px-3 py-2.5 sm:px-5 text-[15px] leading-snug hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors"
    >
      <div className="min-w-0 flex-1">
        {story.lead ? (
          // The link's ::after covers the row, so the whole row clicks through;
          // the caret and the tag sit above it.
          <a
            href={outboundUrl(story.lead.url)}
            target="_blank"
            rel="noopener"
            data-row-headline
            className="text-gray-800 dark:text-gray-200 group-hover:text-brand-700 dark:group-hover:text-brand-300 transition-colors after:absolute after:inset-0 after:content-['']"
          >
            {story.headline}
            <ArrowUpRight
              size={13}
              className="ml-1 inline-block -translate-y-px text-gray-400 dark:text-gray-500 group-hover:text-brand-600 dark:group-hover:text-brand-400"
              aria-hidden="true"
            />
          </a>
        ) : (
          <span data-row-headline className="text-gray-800 dark:text-gray-200">
            {story.headline}
          </span>
        )}
        {story.lead && story.otherOutlets.length > 0 && (
          <OtherSourcesMenu
            sources={story.otherOutlets.map(({ url, outletName }) => ({ url, outletName }))}
            triggerClassName="ml-1.5 -translate-y-px border-l border-gray-300 dark:border-gray-600 pl-1.5 text-gray-400 dark:text-gray-500 hover:text-brand-600 dark:hover:text-brand-400"
          />
        )}
      </div>
      {topic && <RowTopicTag slug={topic.slug} label={topic.label} />}
    </li>
  );
}
