import { ArrowUpRight } from 'lucide-react';
import type { NewsStoryView } from '@/lib/news/queries';
import ShareButton from './ShareButton';
import StoryImage from './StoryImage';
import {
  discussionLabel,
  isUsableStoryImage,
  outboundUrl,
  primaryTopic,
  relativeTime,
  storyAnchorId,
  TAP_AREA,
} from './display';

interface NewsStoryCardProps {
  story: NewsStoryView;
  now: Date;
}

const outboundProps = { target: '_blank', rel: 'noopener' } as const;

/**
 * A Top story: photo, our headline and summary, then one row of links out.
 * The "Read at" button leads that row because the outlet's article is the
 * thing; our summary only points at it.
 */
export default function NewsStoryCard({ story, now }: NewsStoryCardProps) {
  const { lead } = story;
  const topic = primaryTopic(story.topics);
  const imageUrl = isUsableStoryImage(story.imageUrl) ? story.imageUrl : null;

  return (
    <article
      id={storyAnchorId(story.shortId)}
      className="scroll-mt-16 px-3 py-5 sm:px-5 border-b border-gray-200 dark:border-gray-800 last:border-b-0"
    >
      {/* Photo first on phones; beside the text from sm up, so it never outweighs it */}
      <div className="flex flex-col gap-3 sm:flex-row-reverse sm:items-start sm:gap-5">
        {imageUrl && <StoryImage src={imageUrl} className="sm:w-52 sm:shrink-0" />}

        <div className="min-w-0 flex-1">
          <h3 className="font-display text-[19px] sm:text-xl font-semibold leading-snug text-gray-900 dark:text-gray-50">
            {lead ? (
              <a
                href={outboundUrl(lead.url)}
                {...outboundProps}
                className="hover:text-brand-600 dark:hover:text-brand-400"
              >
                {story.headline}
              </a>
            ) : (
              story.headline
            )}
          </h3>
          <p className="mt-1.5 text-[15px] leading-relaxed text-gray-600 dark:text-gray-300">
            {story.summary}
          </p>
        </div>
      </div>

      {/* Everything in this row gets a phone-sized tap area without looking any
          bigger; the row gap keeps those areas from overlapping when it wraps. */}
      <div className="mt-3.5 flex flex-wrap items-center gap-x-2 gap-y-3">
        {lead && (
          <a
            href={outboundUrl(lead.url)}
            {...outboundProps}
            className={`${TAP_AREA} inline-flex max-w-full items-center gap-1 rounded-md border border-brand-600/60 dark:border-brand-400/50 px-2.5 py-1 text-sm font-medium text-brand-700 dark:text-brand-300 hover:bg-brand-50 dark:hover:bg-brand-950/40 transition-colors`}
          >
            <span className="truncate">Read at {lead.outletName}</span>
            <ArrowUpRight size={14} className="shrink-0" aria-hidden="true" />
          </a>
        )}

        {story.otherOutlets.map((outlet) => (
          <a
            key={outlet.url}
            href={outboundUrl(outlet.url)}
            {...outboundProps}
            className={`${TAP_AREA} inline-flex h-6 max-w-full items-center rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-1.5 text-[11px] font-semibold text-gray-600 dark:text-gray-300 hover:border-brand-500 hover:text-brand-700 dark:hover:text-brand-300 transition-colors`}
          >
            <span className="truncate">{outlet.outletName}</span>
          </a>
        ))}

        {story.discussion && (
          <a
            href={outboundUrl(story.discussion.url)}
            {...outboundProps}
            className={`${TAP_AREA} inline-flex items-center gap-0.5 text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-brand-700 dark:hover:text-brand-300 hover:underline`}
          >
            {discussionLabel(story.discussion.url)}
            <ArrowUpRight size={12} aria-hidden="true" />
          </a>
        )}

        {(topic || story.place) && (
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium">
            {/* Named as the topic filter names it, and a shortcut to it.
                A plain anchor, like Clear: same route, fully reloaded. */}
            {topic && (
              <a
                href={`/news?topic=${topic.slug}`}
                className={`${TAP_AREA} inline-flex h-6 items-center rounded border border-brand-100 dark:border-brand-800 bg-brand-50 dark:bg-brand-950/50 px-2 text-brand-700 dark:text-brand-300 hover:border-brand-500 dark:hover:border-brand-500 transition-colors`}
              >
                {topic.label}
              </a>
            )}
            {story.place && (
              <span className="text-gray-500 dark:text-gray-400">
                {topic && <span aria-hidden="true">· </span>}
                {story.place}
              </span>
            )}
          </span>
        )}

        <span className="ml-auto inline-flex items-center gap-1 whitespace-nowrap">
          {/* The newest article's time, which is what decides the day a story
              is filed under */}
          <time
            dateTime={story.lastArticleAt.toISOString()}
            className="text-xs font-medium text-gray-500 dark:text-gray-400"
          >
            {relativeTime(story.lastArticleAt, now)}
          </time>
          <ShareButton shortId={story.shortId} headline={story.headline} />
        </span>
      </div>
    </article>
  );
}
