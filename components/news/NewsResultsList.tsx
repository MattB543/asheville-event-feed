import type { NewsDayView, NewsStoryView } from '@/lib/news/queries';
import NewsDaySection from './NewsDaySection';

/**
 * Search and topic results under the same day headers as the feed, so a list
 * spanning two weeks still says when each story was: Top stories as big cards,
 * everything else as minimal rows. The query already sorts by day, then Top
 * rank, then score.
 */
export default function NewsResultsList({ stories, now }: { stories: NewsStoryView[]; now: Date }) {
  const days: NewsDayView[] = [];
  for (const story of stories) {
    let day = days[days.length - 1];
    if (day?.day !== story.filingDay) {
      day = { day: story.filingDay, shortVersion: null, top: [], more: [] };
      days.push(day);
    }
    (story.topRank !== null ? day.top : day.more).push(story);
  }

  return (
    <div className="flex flex-col gap-8">
      {days.map((day) => (
        <NewsDaySection key={day.day} day={day} now={now} />
      ))}
    </div>
  );
}
