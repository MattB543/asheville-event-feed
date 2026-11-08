/** When a link counts as dead, shared by the cleanup cron's dead-URL pass and the verify cron. */

/** Only these mean "gone". A block is a 403/429/5xx and must never remove an event. */
export const DEAD_STATUSES = new Set([404, 410]);

/**
 * Events the scrapers confirmed this recently are alive by definition: a scraper just fetched
 * them. Scrapes run every 6h, so this is "missed by the last four runs".
 */
export const DEAD_STALE_HOURS = 24;

/**
 * If more than this share of a source's checked events look dead in one run, that is a site
 * change or an outage, not removals, so none of that source's events are marked dead.
 */
const DEAD_SOURCE_MAX_SHARE = 0.2;
const DEAD_SOURCE_MIN_CHECKED = 5;

export function isOverDeadCap(dead: number, checked: number): boolean {
  return checked >= DEAD_SOURCE_MIN_CHECKED && dead / checked > DEAD_SOURCE_MAX_SHARE;
}

/** The dead links a run may act on: every source over the cap is left out whole. */
export function removableDeadLinks<T extends { source: string }>(
  dead: T[],
  checkedBySource: Map<string, number>
): { removable: T[]; skippedSources: string[] } {
  const deadBySource = new Map<string, number>();
  for (const link of dead) deadBySource.set(link.source, (deadBySource.get(link.source) ?? 0) + 1);
  const skippedSources = [...deadBySource]
    .filter(([source, count]) => isOverDeadCap(count, checkedBySource.get(source) ?? 0))
    .map(([source]) => source);
  return {
    removable: dead.filter((link) => !skippedSources.includes(link.source)),
    skippedSources,
  };
}
