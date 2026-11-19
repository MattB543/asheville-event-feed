import type { CampCard } from '@/lib/camps/contract';
import { milestoneWhen } from '@/lib/camps/display';
import type { UnpinnedSite } from '@/lib/db/queries/camps';
import {
  CAMP_SEARCH_LIMIT,
  OPENING_SOON_DAYS,
  REVIEW_TIERS,
  reviewTier,
  type AdminCamp,
  type HiddenCamp,
  type OpeningSoonCamp,
  type OrsPinnedSite,
} from '@/lib/db/queries/campsAdmin';
import ActionButton from './ActionButton';
import PinSite from './PinSite';
import ReviewItem from './ReviewItem';

export interface CampAdminData {
  queue: AdminCamp[];
  /**
   * Unconfirmed camps, whatever their confidence, with a registration date in the next
   * OPENING_SOON_DAYS, soonest first.
   */
  soon: OpeningSoonCamp[];
  /** Which list "To review" shows: those opening soon (the default) or the whole queue. */
  view: 'soon' | 'all';
  unpinned: UnpinnedSite[];
  orsPins: OrsPinnedSite[];
  hidden: HiddenCamp[];
  liveCount: number;
  /** `?q=` and the live camps it matches (up to CAMP_SEARCH_LIMIT + 1). */
  search: { query: string; results: AdminCamp[] };
}

/** The queue is long (most cards are medium confidence), so the page shows its top. */
const REVIEW_PAGE_SIZE = 30;

const sectionTitle = 'mt-8 mb-2 text-lg font-bold text-gray-900 dark:text-gray-100';
const emptyText = 'text-sm text-gray-600 dark:text-gray-400';
const listBox =
  'divide-y divide-gray-200 rounded-xl border border-gray-200 bg-white px-4 dark:divide-gray-800 dark:border-gray-800 dark:bg-gray-900';

function Count({ href, value, label }: { href: string; value: number; label: string }) {
  return (
    <a
      href={href}
      className="rounded-lg border border-gray-200 bg-white px-3 py-2 hover:bg-gray-100 dark:border-gray-800 dark:bg-gray-900 dark:hover:bg-gray-800"
    >
      <span className="block text-xl font-bold text-gray-900 dark:text-gray-100">{value}</span>
      <span className="text-xs text-gray-600 dark:text-gray-400">{label}</span>
    </a>
  );
}

/** The review queue, the sites that need a pin, the hidden camps, and a search of every camp. */
export default function CampAdmin({
  queue,
  soon,
  view,
  unpinned,
  orsPins,
  hidden,
  liveCount,
  search,
  cardKeys,
}: CampAdminData & { cardKeys: Array<keyof CampCard> }) {
  const shown = search.results.slice(0, CAMP_SEARCH_LIMIT);
  // The review list's two views (the search form's GET leaves `view` out: back to the default)
  const viewHref = (target: 'soon' | 'all') => (target === 'all' ? '?view=all#review' : '?#review');
  return (
    <>
      <div className="mt-4 flex flex-wrap gap-2">
        <Count href={viewHref('soon')} value={soon.length} label="opening soon" />
        <Count href={viewHref('all')} value={queue.length} label="to review" />
        <Count href="#pins" value={unpinned.length} label="pins needed" />
        <Count href="#ors-pins" value={orsPins.length} label="ORS pins to check" />
        <Count href="#hidden" value={hidden.length} label="hidden" />
        <Count href="#all" value={liveCount} label="live camps (search)" />
      </div>

      <h2 id="review" className={sectionTitle}>
        {view === 'soon' ? 'Opening soon' : 'To review'}
      </h2>
      <p className={`${emptyText} mb-3`}>
        {view === 'soon'
          ? `Camps you haven't confirmed with a registration date (anyone's) in the next ${OPENING_SOON_DAYS} days, soonest first, high confidence included: a wrong date there costs a parent first. `
          : 'Camps or registration dates short of high confidence, most important first. '}
        Confirm marks this exact card as checked; a re-extraction that changes its facts brings it
        back.{' '}
        <a
          href={viewHref(view === 'soon' ? 'all' : 'soon')}
          className="text-brand-600 hover:underline dark:text-brand-400"
        >
          {view === 'soon'
            ? `See the whole queue (${queue.length})`
            : `See opening soon (${soon.length})`}
        </a>
      </p>
      {view === 'soon' ? (
        soon.length === 0 ? (
          <p className={emptyText}>
            No unconfirmed camp has a registration date in the next {OPENING_SOON_DAYS} days.
          </p>
        ) : (
          <>
            <ul className="space-y-4">
              {soon.slice(0, REVIEW_PAGE_SIZE).map(({ camp, date }) => (
                <li key={camp.id} className="list-none">
                  <h3 className="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-300">
                    {date.audience} {date.kind.replace('_', ' ')} {milestoneWhen(date)}
                  </h3>
                  <ul>
                    <ReviewItem item={camp} cardKeys={cardKeys} confirmAnyConfidence />
                  </ul>
                </li>
              ))}
            </ul>
            {soon.length > REVIEW_PAGE_SIZE && (
              <p className={`${emptyText} mt-3`}>
                {soon.length - REVIEW_PAGE_SIZE} more after these; reload after confirming or hiding
                to bring them up.
              </p>
            )}
          </>
        )
      ) : queue.length === 0 ? (
        <p className={emptyText}>Nothing to review.</p>
      ) : (
        <>
          <ul className={`${emptyText} mb-3 list-disc pl-5`}>
            {REVIEW_TIERS.map((label, tier) => (
              <li key={label}>
                {label}: {queue.filter((item) => reviewTier(item.card) === tier).length}
              </li>
            ))}
          </ul>
          <ul className="space-y-4">
            {queue.slice(0, REVIEW_PAGE_SIZE).map((item, index) => {
              const tier = reviewTier(item.card);
              const firstOfTier = index === 0 || reviewTier(queue[index - 1].card) !== tier;
              return (
                <li key={item.id} className="list-none">
                  {firstOfTier && (
                    <h3 className="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-300">
                      {REVIEW_TIERS[tier]}
                    </h3>
                  )}
                  <ul>
                    <ReviewItem item={item} cardKeys={cardKeys} />
                  </ul>
                </li>
              );
            })}
          </ul>
          {queue.length > REVIEW_PAGE_SIZE && (
            <p className={`${emptyText} mt-3`}>
              {queue.length - REVIEW_PAGE_SIZE} more after these; reload after confirming or hiding
              to bring them up.
            </p>
          )}
        </>
      )}

      <h2 id="pins" className={sectionTitle}>
        Pins needed
      </h2>
      <p className={`${emptyText} mb-3`}>
        The geocoder couldn&apos;t place these (a site added by a fix waits here for the next
        import). In Google Maps, right-click the drop-off spot, click the coordinates to copy them,
        and paste them here.
      </p>
      {unpinned.length === 0 ? (
        <p className={emptyText}>Every site has a pin.</p>
      ) : (
        <ul className={listBox}>
          {unpinned.map((site) => (
            <PinSite key={site.id} site={site} />
          ))}
        </ul>
      )}

      <h2 id="ors-pins" className={sectionTitle}>
        ORS pins to check
      </h2>
      <p className={`${emptyText} mb-3`}>
        Placed by ORS, which can pick another street of the same name. Paste a better pin, or keep
        ORS&apos;s.
      </p>
      {orsPins.length === 0 ? (
        <p className={emptyText}>None.</p>
      ) : (
        <ul className={listBox}>
          {orsPins.map(({ lat, lng, label, ...site }) => (
            <PinSite key={site.id} site={site} ors={{ lat, lng, label }} />
          ))}
        </ul>
      )}

      <h2 id="hidden" className={sectionTitle}>
        Hidden
      </h2>
      {hidden.length === 0 ? (
        <p className={emptyText}>No hidden camps.</p>
      ) : (
        <ul className={listBox}>
          {hidden.map((camp) => (
            <li key={camp.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <p className="min-w-0 text-sm">
                <span className="font-semibold text-gray-900 dark:text-gray-100">{camp.name}</span>
                <span className="text-gray-600 dark:text-gray-400"> · {camp.providerName}</span>
              </p>
              <ActionButton body={{ action: 'unhide', id: camp.id }} label="Unhide" />
            </li>
          ))}
        </ul>
      )}

      <h2 id="all" className={sectionTitle}>
        All camps
      </h2>
      <p className={`${emptyText} mb-3`}>
        Find any live camp, confirmed or high confidence included, to hide or fix it.
      </p>
      <form method="get" action="#all" role="search" className="mb-4 flex flex-wrap gap-2">
        <input
          type="search"
          name="q"
          defaultValue={search.query}
          placeholder="Camp, provider or slug"
          aria-label="Search camps by name, provider or slug"
          className="min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 sm:max-w-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
        />
        <button
          type="submit"
          className="cursor-pointer rounded-md border border-gray-300 px-3 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          Search
        </button>
      </form>
      {search.query &&
        (shown.length === 0 ? (
          <p className={emptyText}>No live camp matches “{search.query}”.</p>
        ) : (
          <>
            {search.results.length > shown.length && (
              <p className={`${emptyText} mb-3`}>
                Showing the first {CAMP_SEARCH_LIMIT}; narrow the search to see the rest.
              </p>
            )}
            <ul className="space-y-4">
              {shown.map((item) => (
                <ReviewItem key={item.id} item={item} cardKeys={cardKeys} />
              ))}
            </ul>
          </>
        ))}
    </>
  );
}
