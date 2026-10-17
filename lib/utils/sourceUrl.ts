const AVL_TODAY_HOUR = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  hour12: false,
});

/**
 * Where "View original" goes. AVL Today's stored URL is often a venue or organizer
 * page, so its listing is rebuilt from the title, id and Eastern start hour.
 */
export function eventSourceUrl(event: {
  source: string;
  url: string;
  title: string;
  sourceId: string;
  startDate: Date | string;
}): string {
  if (event.source !== 'AVL_TODAY') return event.url;
  const slug = event.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '');
  const parts = AVL_TODAY_HOUR.formatToParts(new Date(event.startDate));
  const part = (type: string) => parts.find((p) => p.type === type)?.value;
  const hour = `${part('year')}-${part('month')}-${part('day')}T${part('hour')}`;
  return `https://avltoday.6amcity.com/events#/details/${slug}/${event.sourceId}/${hour}`;
}
