import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  needsReview,
  type CampCard,
  type Confidence,
  type PriceTier,
  type Session,
} from '@/lib/camps/contract';
import type { AdminCamp } from '@/lib/db/queries/campsAdmin';
import ActionButton from './ActionButton';
import FixField from './FixField';

/** How many session rows to show before "N more". */
const SESSION_PREVIEW = 3;

const CONFIDENCE_STYLES: Record<Confidence, string> = {
  high: 'bg-green-100 text-green-800 dark:bg-green-950/60 dark:text-green-300',
  medium: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300',
  low: 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300',
};

function ConfidenceBadge({ confidence }: { confidence: Confidence }) {
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-xs font-semibold ${CONFIDENCE_STYLES[confidence] ?? CONFIDENCE_STYLES.low}`}
    >
      {confidence}
    </span>
  );
}

function formatRange(
  range: { min: number | null; max: number | null } | null,
  label: (value: number) => string = String
): string | null {
  if (!range || (range.min === null && range.max === null)) return null;
  if (range.min === null) return `up to ${label(range.max!)}`;
  if (range.max === null) return `${label(range.min)}+`;
  return range.min === range.max ? label(range.min) : `${label(range.min)}–${label(range.max)}`;
}

const gradeLabel = (grade: number) => (grade === -1 ? 'Pre-K' : grade === 0 ? 'K' : String(grade));

function formatPrice(price: PriceTier): string {
  return `$${price.amount}/${price.unit}${price.label ? ` (${price.label})` : ''}, ${price.year}`;
}

function formatSession(row: Session): string {
  const ages = formatRange(row.ages);
  const grades = formatRange(row.grades, gradeLabel);
  return [
    row.label ?? 'Row',
    `${row.start} to ${row.end}`,
    row.site,
    ages && `ages ${ages}`,
    grades && `grades ${grades}`,
    row.price && formatPrice(row.price),
    row.status,
  ]
    .filter(Boolean)
    .join(' · ');
}

function shortUrl(url: string): string {
  try {
    const { host, pathname } = new URL(url);
    const text = `${host.replace(/^www\./, '')}${pathname === '/' ? '' : pathname}`;
    return text.length > 60 ? `${text.slice(0, 57)}…` : text;
  } catch {
    return url;
  }
}

const linkClass = 'text-brand-600 hover:underline dark:text-brand-400';

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={linkClass}>
      {children}
    </a>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[5.5rem_1fr] gap-2">
      <dt className="text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className="min-w-0 break-words text-gray-800 dark:text-gray-200">{children}</dd>
    </div>
  );
}

/**
 * The key facts of one camp, with Hide and Fix, and Confirm while it's short of high confidence
 * and not confirmed as it stands.
 */
export default function ReviewItem({
  item,
  cardKeys,
}: {
  item: AdminCamp;
  cardKeys: Array<keyof CampCard>;
}) {
  const { card } = item;
  const fixed = Object.keys(item.override ?? {});
  const ages = formatRange(card.ages);
  const grades = formatRange(card.grades, gradeLabel);
  const toConfirm = needsReview(card) && !item.confirmed;

  return (
    <li className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h3 className="font-semibold text-gray-900 dark:text-gray-100">{card.name}</h3>
        <ConfidenceBadge confidence={card.confidence} />
        <span className="text-sm text-gray-600 dark:text-gray-400">
          {item.providerName} · {card.type}
        </span>
      </div>
      {card.review_notes && (
        <p className="mt-2 whitespace-pre-wrap text-sm text-amber-900 dark:text-amber-200">
          {card.review_notes}
        </p>
      )}
      {fixed.length > 0 && (
        <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">Fixed: {fixed.join(', ')}</p>
      )}
      {item.reviewedAt && (
        <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
          {item.confirmed ? 'Confirmed as it stands' : 'Confirmed before, then the card changed'}
        </p>
      )}

      <dl className="mt-3 space-y-1.5 text-sm">
        <Fact label="Season">
          {card.season.year} · {card.season.status}
          {(card.season.start || card.season.end) &&
            ` · ${card.season.start ?? '?'} to ${card.season.end ?? '?'}`}
          {card.season.text && ` · “${card.season.text}”`}
        </Fact>
        <Fact label="Who">
          {[ages && `ages ${ages}`, grades && `grades ${grades} (${card.grades?.basis})`]
            .filter(Boolean)
            .join(' · ') || 'not stated'}
        </Fact>
        <Fact label="Sites">
          {card.sites.length === 0 ? (
            'none'
          ) : (
            <ul>
              {card.sites.map((site, index) => (
                <li key={index}>
                  {site.name}
                  <span className="text-gray-500 dark:text-gray-400">
                    {' '}
                    —{' '}
                    {[site.address, site.town, site.state].filter(Boolean).join(', ') ||
                      'no address'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Fact>
        <Fact label="Prices">
          {card.prices.length === 0 ? 'none' : card.prices.map(formatPrice).join('; ')}
        </Fact>
        <Fact label={`Rows (${card.sessions.length})`}>
          {card.sessions.length === 0 ? (
            'none'
          ) : (
            <ul>
              {card.sessions.slice(0, SESSION_PREVIEW).map((row, index) => (
                <li key={index}>{formatSession(row)}</li>
              ))}
              {card.sessions.length > SESSION_PREVIEW && (
                <li className="text-gray-500 dark:text-gray-400">
                  + {card.sessions.length - SESSION_PREVIEW} more
                </li>
              )}
            </ul>
          )}
        </Fact>
        <Fact label="Registration">
          {card.registration.length === 0 ? (
            'no dates'
          ) : (
            <ul className="space-y-1.5">
              {card.registration.map((milestone, index) => (
                <li key={index}>
                  <ConfidenceBadge confidence={milestone.confidence} />{' '}
                  <span className="font-medium">
                    {milestone.audience} {milestone.kind}: {milestone.date}
                    {milestone.time && ` ${milestone.time}`}
                  </span>{' '}
                  <span className="text-gray-500 dark:text-gray-400">
                    ({milestone.precision}, {milestone.certainty}, for {milestone.year})
                  </span>
                  <br />“{milestone.text}” <ExternalLink href={milestone.url}>page</ExternalLink>
                </li>
              ))}
            </ul>
          )}
        </Fact>
        <Fact label="Sources">
          <ul>
            {card.sources.map((url, index) => (
              <li key={index}>
                <ExternalLink href={url}>{shortUrl(url)}</ExternalLink>
              </li>
            ))}
          </ul>
        </Fact>
      </dl>

      <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <Link href={`/camps/${item.slug}`} target="_blank" className={linkClass}>
          Public page
        </Link>
        {card.camp_page_url && <ExternalLink href={card.camp_page_url}>Camp page</ExternalLink>}
        {card.registration_url && (
          <ExternalLink href={card.registration_url}>Registration</ExternalLink>
        )}
      </p>

      <div className="mt-3 flex flex-wrap items-start gap-2">
        {toConfirm && (
          <ActionButton
            body={{ action: 'confirm', id: item.id, hash: item.hash }}
            label="Confirm"
            tone="primary"
          />
        )}
        <ActionButton body={{ action: 'hide', id: item.id }} label="Hide" tone="danger" />
        {fixed.length > 0 && (
          <ActionButton body={{ action: 'clear_override', id: item.id }} label="Clear fixes" />
        )}
      </div>
      <FixField id={item.id} card={card} cardKeys={cardKeys} />
    </li>
  );
}
