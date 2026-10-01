import { Sparkles } from 'lucide-react';
import type { NewsDayView } from '@/lib/news/queries';
import NewsStoryCard from './NewsStoryCard';
import NewsStoryRow from './NewsStoryRow';
import { dayLabel, storyAnchorId } from './display';

interface NewsDaySectionProps {
  day: NewsDayView;
  now: Date;
}

/** Section labels inside a day, in the posters marker's small-caps voice. */
export function NewsListLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="px-3 sm:px-5 pt-4 pb-1 text-[11px] font-bold uppercase tracking-[0.14em] text-gray-500 dark:text-gray-400">
      {children}
    </h3>
  );
}

/**
 * The short version: one AI sentence per Top story, run together as a
 * paragraph, each sentence a link down to its card.
 */
function ShortVersion({
  sentences,
  linkable,
}: {
  sentences: { storyId: string; text: string }[];
  linkable: Set<string>;
}) {
  return (
    <div className="px-3 sm:px-5 py-4 bg-brand-50/70 dark:bg-brand-950/30 border-b border-brand-100 dark:border-brand-900/60">
      <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-brand-700 dark:text-brand-300">
        <Sparkles size={13} aria-hidden="true" />
        The short version
      </p>
      <p className="mt-2 text-[15px] leading-relaxed text-gray-800 dark:text-gray-100">
        {sentences.map((sentence, index) => (
          <span key={`${sentence.storyId}-${index}`}>
            {index > 0 && ' '}
            {linkable.has(sentence.storyId) ? (
              <a
                href={`#${storyAnchorId(sentence.storyId)}`}
                className="underline decoration-brand-300 dark:decoration-brand-700 decoration-1 underline-offset-[3px] hover:text-brand-700 dark:hover:text-brand-300 hover:decoration-current"
              >
                {sentence.text}
              </a>
            ) : (
              // Its story was hidden after the summary was written
              sentence.text
            )}
          </span>
        ))}
      </p>
    </div>
  );
}

export default function NewsDaySection({ day, now }: NewsDaySectionProps) {
  const label = dayLabel(day.day, now);
  const headingId = `news-day-${day.day}`;
  const onCards = new Set(day.top.map((story) => story.shortId));

  return (
    <section aria-labelledby={headingId} className="flex flex-col">
      {/* Sticky like the events feed's date headers */}
      <h2
        id={headingId}
        className="sticky top-0 z-10 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 sm:border sm:rounded-t-lg pt-3 pb-2 px-3 sm:px-5 text-xl font-bold text-gray-800 dark:text-gray-100"
      >
        {label}
      </h2>

      <div className="bg-white dark:bg-gray-900 sm:border sm:border-t-0 border-gray-200 dark:border-gray-800 sm:rounded-b-lg sm:shadow-sm overflow-hidden">
        {day.shortVersion && <ShortVersion sentences={day.shortVersion} linkable={onCards} />}

        {day.top.map((story) => (
          <NewsStoryCard key={story.id} story={story} now={now} />
        ))}

        {day.more.length > 0 && (
          <div className="pb-2">
            {day.top.length > 0 && <NewsListLabel>More news</NewsListLabel>}
            <ul className={day.top.length > 0 ? '' : 'pt-2'}>
              {day.more.map((story) => (
                <NewsStoryRow key={story.id} story={story} />
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
