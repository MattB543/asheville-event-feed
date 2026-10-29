import { and, eq, inArray, like, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { events } from '@/lib/db/schema';
import {
  queryCamps,
  stableJson,
  type CampListing,
  type CampSiteInfo,
} from '@/lib/db/queries/camps';
import { invalidateEventsCache } from '@/lib/cache/invalidation';
import { SUMMER_CAMP_TAG } from '@/lib/config/tagCategories';
import { CAMPS_SOURCE } from '@/lib/utils/eventFilterMatch';
import { getZipFromCoords } from '@/lib/utils/geo';
import { parseAsEastern } from '@/lib/utils/timezone';
import type { CampCard, CampCategory, CampType } from './contract';
import { TARGET_SEASON, toCardData, type CampCardData, type Labeled } from './display';

/**
 * Summer camps in the event feed (docs/camps/01-context-and-plan.md §4.8): one CAMPS event per
 * live, in-radius camp card (queryCamps), dated at its first session of the coming summer.
 *
 * - Identity: sourceId `camp:<camp id>:<summer>` and url `https://www.avlgo.com/camps/<slug>?season=
 *   <summer>`, so each summer is its own row (events.url is unique). The url is our camp page, never
 *   the camp's site, which an AVL Today row may already use.
 * - A camp gets an event once it has a date in that summer. The event is soft-deleted (`deadAt`,
 *   never a hard delete) when the camp is hidden, leaves the radius or loses that date, and restored
 *   (deadAt cleared) when it qualifies again, so the sync owns `deadAt` on these rows. It never
 *   writes `hidden`: that stays moderation, and an event hidden by hand stays hidden.
 * - Dated at its first session, and placed at that session's site.
 * - Tags are written complete, since the AI cron only tags untagged events (it still writes the
 *   summary, embedding and scores).
 * - `dedup_skip` keeps rule-based and AI dedup away from them. The feed lists camps only while the
 *   Summer Camp tag is selected, Top 30 never does (isCampEvent), and the cleanup cron skips them.
 *
 * planCampEvents() only reads; syncCampEvents() writes its plan. Running either twice changes nothing,
 * and a sync that starts while another runs skips (SYNC_LOCK).
 */

/** Canonical host, not SITE_URL: the url is the row's identity and must not change with the env. */
const CAMP_PAGES = 'https://www.avlgo.com/camps/';

/** pg_try_advisory_xact_lock key ("camps" in ASCII) held while a sync plans and writes. */
const SYNC_LOCK = 0x63616d7073;

/** Stored with timeUnknown when the camp gives no start time, as the Parks & Rec scraper does. */
const UNKNOWN_TIME = '12:00';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The official tag for each camp category; null where none fits ("Live Music" means concerts). */
const CATEGORY_TAGS: Record<CampCategory, string | null> = {
  arts: 'Art',
  music: null,
  theater: 'Theater & Film',
  dance: 'Dance',
  stem: 'Tech',
  nature_outdoor: 'Outdoors',
  sports: 'Sports',
  horses: 'Outdoors',
  cooking: null,
  academic: 'Education',
  faith_based: 'Spiritual',
  general: null,
  special_needs: null,
};

/** A custom tag for the camp type (custom tags are lowercase, at most 3 words, no hyphens). */
const TYPE_TAGS: Record<CampType, string> = {
  day: 'day camp',
  half_day: 'half day camp',
  overnight: 'overnight camp',
  evening: 'evening camp',
  vbs: 'vacation bible school',
  clinic: 'clinic',
  pre_college: 'pre college',
};

/** A renamed camp's summary, embedding and scores name the old camp; the AI cron redoes them. */
const AI_RESET: Partial<typeof events.$inferInsert> = {
  aiSummary: null,
  embedding: null,
  score: null,
  scoreRarity: null,
  scoreUnique: null,
  scoreMagnitude: null,
  scoreReason: null,
  scoreAshevilleWeird: null,
  scoreSocial: null,
  aiAttempts: 0,
  aiNextAttemptAt: null,
};

/** The columns the sync writes from a camp (source, dedup_skip and the timestamps aside). */
export interface CampEventValues {
  sourceId: string;
  url: string;
  title: string;
  description: string;
  startDate: Date;
  timeUnknown: boolean;
  location: string | null;
  zip: string | null;
  organizer: string;
  price: string | null;
  tags: string[];
}

export interface CampEventPlan {
  season: number;
  /** Live, in-radius camps, and how many of them have a date in the season. */
  camps: number;
  dated: number;
  create: CampEventValues[];
  /** `changed` lists `deadAt` when the row comes back. */
  update: Array<{ id: string; values: CampEventValues; changed: string[] }>;
  /** Rows to soft-delete (deadAt). */
  remove: Array<{ id: string; title: string; reason: string }>;
  /** Rows already as they should be: the sync only marks them seen. */
  unchanged: string[];
}

/** db, or the sync's transaction. */
type Reader = Pick<typeof db, 'select'>;

function campSourceId(campId: string): string {
  return `camp:${campId}:${TARGET_SEASON}`;
}

/** A real YYYY-MM-DD date in the season's year. */
function inSeason(date: string | null | undefined): date is string {
  if (!date || !ISO_DATE.test(date) || !date.startsWith(`${TARGET_SEASON}-`)) return false;
  const parsed = new Date(`${date}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(date);
}

/**
 * The first session start in the season (with that session's hours, else the card's, and its
 * site), else the season start; null when the camp hasn't posted a date in that summer.
 */
function seasonStart(
  card: CampCard
): { date: string; time: string | null; site: string | null } | null {
  const [first] = card.sessions
    .filter((session) => inSeason(session.start))
    .map((session) => ({
      date: session.start,
      time: session.hours?.start ?? card.hours?.start ?? null,
      site: session.site,
    }))
    // Known start times sort before unknown ones on the same day ('~' follows the digits)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '~').localeCompare(b.time ?? '~'));
  if (first) return first;
  return inSeason(card.season.start)
    ? { date: card.season.start, time: card.hours?.start ?? null, site: null }
    : null;
}

function campTags(card: CampCard): string[] {
  const official = card.categories.map((category) => CATEGORY_TAGS[category] ?? null);
  const tags = [SUMMER_CAMP_TAG, 'Family', ...official, TYPE_TAGS[card.type] ?? null];
  return [...new Set(tags.filter((tag): tag is string => !!tag))];
}

/** "Asheville Archery Training Center, 1426 Brevard Road, Asheville, NC" */
function siteLocation(site: CampSiteInfo): string {
  const town = site.town && (site.state ? `${site.town}, ${site.state}` : site.town);
  // A town estimate (driveFromTown) is named after its town: "Weaverville, NC", not twice
  const name = site.name === site.town ? null : site.name;
  return [name, site.address, town].filter(Boolean).join(', ');
}

/** The camp's own description, then the facts parents filter on, as /camps shows them. */
function describe(camp: CampListing, data: CampCardData): string {
  // A label that isn't for the coming summer says which one it is: "Price (2026): ...". A note is
  // the camp's own words on the fact, which /camps shows under it: "Price: $175/week (Half day)."
  const line = (label: string, value: Labeled | string | null, note: string | null = null) => {
    const fact = typeof value === 'string' ? { text: value, year: TARGET_SEASON } : value;
    const said = note?.trim().replace(/\.$/, '') || null;
    const text = fact?.text && said ? `${fact.text} (${said})` : fact?.text || said;
    if (!text) return null;
    const year = fact && fact.year !== TARGET_SEASON ? ` (${fact.year})` : '';
    return `${label}${year}: ${text}${text.endsWith('.') ? '' : '.'}`;
  };
  const facts = [
    line('When', data.season),
    line('Who', data.who),
    line('Hours', data.hours, data.hoursNote),
    line('Price', data.price, data.priceNote),
    camp.sites.length > 1 ? line('Sites', camp.sites.map((site) => site.name).join('; ')) : null,
  ].filter((fact): fact is string => !!fact);
  return [camp.card.description.trim(), facts.join('\n')].filter(Boolean).join('\n\n');
}

function campEventValues(camp: CampListing, now: Date): CampEventValues | null {
  const start = seasonStart(camp.card);
  if (!start) return null;
  const time = start.time && HH_MM.test(start.time) ? start.time : null;
  const data = toCardData(camp, now);
  // Where that first session is. A session naming a site the card doesn't list has no known
  // location; one naming no site takes the first placed site.
  const site = start.site
    ? camp.sites.find((s) => s.name === start.site)
    : (camp.sites.find((s) => s.lat !== null && s.lng !== null) ?? camp.sites[0]);
  return {
    sourceId: campSourceId(camp.id),
    url: `${CAMP_PAGES}${camp.slug}?season=${TARGET_SEASON}`,
    title: camp.card.name.trim(),
    description: describe(camp, data),
    startDate: parseAsEastern(start.date, `${time ?? UNKNOWN_TIME}:00`),
    timeUnknown: !time,
    location: site ? siteLocation(site) : null,
    zip: (site && getZipFromCoords(site.lat ?? undefined, site.lng ?? undefined)) ?? null,
    organizer: camp.providerName,
    // formatPriceDisplay reads "$1,200" as $1, so no thousands separators
    price: data.price ? data.price.text.replace(/(\d),(?=\d{3})/g, '$1') : null,
    tags: campTags(camp.card),
  };
}

/** What syncCampEvents would write. Reads only. */
export async function planCampEvents(reader: Reader = db): Promise<CampEventPlan> {
  const [camps, rows] = await Promise.all([
    queryCamps(),
    reader
      .select({
        id: events.id,
        sourceId: events.sourceId,
        url: events.url,
        title: events.title,
        description: events.description,
        startDate: events.startDate,
        timeUnknown: events.timeUnknown,
        location: events.location,
        zip: events.zip,
        organizer: events.organizer,
        price: events.price,
        tags: events.tags,
        deadAt: events.deadAt,
      })
      .from(events)
      .where(
        and(eq(events.source, CAMPS_SOURCE), like(events.sourceId, `camp:%:${TARGET_SEASON}`))
      ),
  ]);

  const now = new Date();
  const wanted = new Map<string, CampEventValues>();
  for (const camp of camps) {
    const values = campEventValues(camp, now);
    if (values) wanted.set(values.sourceId, values);
  }
  const live = new Set(camps.map((camp) => campSourceId(camp.id)));

  const plan: CampEventPlan = {
    season: TARGET_SEASON,
    camps: camps.length,
    dated: wanted.size,
    create: [],
    update: [],
    remove: [],
    unchanged: [],
  };
  for (const row of rows) {
    const values = wanted.get(row.sourceId);
    if (!values) {
      if (!row.deadAt) {
        plan.remove.push({
          id: row.id,
          title: row.title,
          reason: live.has(row.sourceId)
            ? `no ${TARGET_SEASON} date`
            : 'camp hidden, gone or out of radius',
        });
      }
      continue;
    }
    // Claimed, so a second row with the same sourceId is removed rather than updated too
    wanted.delete(row.sourceId);
    const changed: string[] = (Object.keys(values) as Array<keyof CampEventValues>).filter(
      (key) => stableJson(row[key] ?? null) !== stableJson(values[key])
    );
    if (row.deadAt) changed.push('deadAt');
    if (changed.length > 0) plan.update.push({ id: row.id, values, changed });
    else plan.unchanged.push(row.id);
  }
  plan.create = [...wanted.values()];
  return plan;
}

/**
 * Bring the CAMPS events in line with the live camps: create, update, or soft-delete (deadAt).
 * Callable from scripts and route handlers; it expires the feed's cache when it changed anything.
 * It plans and writes holding SYNC_LOCK, so a second sync at the same time waits, then plans from
 * what the first wrote: no duplicate insert, no update planned from rows that have since changed.
 */
export async function syncCampEvents(): Promise<{
  created: number;
  updated: number;
  removed: number;
}> {
  const now = new Date();

  const plan = await db.transaction(async (tx) => {
    // Try, don't wait: a waiting sync would hold a pooled connection the running one may need for
    // its reads. The running sync writes the same plan, so skipping is safe.
    const [lock] = await tx.execute<{ locked: boolean }>(
      sql`SELECT pg_try_advisory_xact_lock(${SYNC_LOCK}::bigint) AS locked`
    );
    if (!lock?.locked) return null;
    const plan = await planCampEvents(tx);
    if (plan.create.length > 0) {
      await tx.insert(events).values(
        plan.create.map((values) => ({
          ...values,
          source: CAMPS_SOURCE,
          dedupSkip: true,
          lastSeenAt: now,
        }))
      );
    }
    for (const { id, values, changed } of plan.update) {
      await tx
        .update(events)
        .set({
          ...values,
          ...(changed.includes('title') ? AI_RESET : {}),
          deadAt: null,
          dedupSkip: true,
          updatedAt: now,
          lastSeenAt: now,
        })
        .where(eq(events.id, id));
    }
    if (plan.remove.length > 0) {
      await tx
        .update(events)
        .set({ deadAt: now })
        .where(
          inArray(
            events.id,
            plan.remove.map((row) => row.id)
          )
        );
    }
    // Seen, like a scraper's lastSeenAt, so cron:health doesn't call the source stale
    if (plan.unchanged.length > 0) {
      await tx.update(events).set({ lastSeenAt: now }).where(inArray(events.id, plan.unchanged));
    }
    return plan;
  });

  if (!plan) {
    console.log('[Camps] Feed events: another sync is running; skipped');
    return { created: 0, updated: 0, removed: 0 };
  }
  const result = {
    created: plan.create.length,
    updated: plan.update.length,
    removed: plan.remove.length,
  };
  console.log(
    `[Camps] Feed events: ${result.created} created, ${result.updated} updated, ${result.removed} removed, ${plan.unchanged.length} unchanged`
  );
  if (result.created + result.updated + result.removed > 0) invalidateEventsCache();
  return result;
}
