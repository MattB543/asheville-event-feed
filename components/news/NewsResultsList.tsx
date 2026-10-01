import type { NewsStoryView } from '@/lib/news/queries';
import NewsStoryCard from './NewsStoryCard';
import NewsStoryRow from './NewsStoryRow';

/**
 * Search and topic results as one flat list in the order given: Top stories
 * as big cards, everything else as minimal rows. Runs of rows share a <ul>.
 */
export default function NewsResultsList({ stories, now }: { stories: NewsStoryView[]; now: Date }) {
  const blocks: (NewsStoryView | NewsStoryView[])[] = [];
  for (const story of stories) {
    const last = blocks[blocks.length - 1];
    if (story.topRank !== null) blocks.push(story);
    else if (Array.isArray(last)) last.push(story);
    else blocks.push([story]);
  }

  return (
    <div className="bg-white dark:bg-gray-900 sm:border border-y border-gray-200 dark:border-gray-800 sm:rounded-lg sm:shadow-sm overflow-hidden">
      {blocks.map((block) =>
        Array.isArray(block) ? (
          <ul
            key={block[0].id}
            className="py-2 border-b border-gray-200 dark:border-gray-800 last:border-b-0"
          >
            {block.map((story) => (
              <NewsStoryRow key={story.id} story={story} />
            ))}
          </ul>
        ) : (
          <NewsStoryCard key={block.id} story={block} now={now} />
        )
      )}
    </div>
  );
}
