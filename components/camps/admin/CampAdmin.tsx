import type { CampCard } from '@/lib/camps/contract';
import type { CampReviewItem, UnpinnedSite } from '@/lib/db/queries/camps';
import type { HiddenCamp, OrsPinnedSite } from '@/lib/db/queries/campsAdmin';
import ActionButton from './ActionButton';
import PinSite from './PinSite';
import ReviewItem from './ReviewItem';

export interface CampAdminData {
  queue: CampReviewItem[];
  unpinned: UnpinnedSite[];
  orsPins: OrsPinnedSite[];
  hidden: HiddenCamp[];
}

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

/** The review queue, the sites that need a pin, and the hidden camps. */
export default function CampAdmin({
  queue,
  unpinned,
  orsPins,
  hidden,
  cardKeys,
}: CampAdminData & { cardKeys: Array<keyof CampCard> }) {
  return (
    <>
      <div className="mt-4 flex flex-wrap gap-2">
        <Count href="#review" value={queue.length} label="to review" />
        <Count href="#pins" value={unpinned.length} label="pins needed" />
        <Count href="#ors-pins" value={orsPins.length} label="ORS pins to check" />
        <Count href="#hidden" value={hidden.length} label="hidden" />
      </div>

      <h2 id="review" className={sectionTitle}>
        To review
      </h2>
      <p className={`${emptyText} mb-3`}>
        Camps or registration dates short of high confidence. Confirm marks this exact card as
        checked; a re-extraction that changes it brings it back.
      </p>
      {queue.length === 0 ? (
        <p className={emptyText}>Nothing to review.</p>
      ) : (
        <ul className="space-y-4">
          {queue.map((item) => (
            <ReviewItem key={item.id} item={item} cardKeys={cardKeys} />
          ))}
        </ul>
      )}

      <h2 id="pins" className={sectionTitle}>
        Pins needed
      </h2>
      <p className={`${emptyText} mb-3`}>
        The geocoder couldn&apos;t place these. In Google Maps, right-click the drop-off spot, click
        the coordinates to copy them, and paste them here.
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
    </>
  );
}
