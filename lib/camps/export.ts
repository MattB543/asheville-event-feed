/**
 * The camp directory as one file a parent can hand to their own AI (ChatGPT, Claude ...): every
 * live camp, as Markdown or JSON, served by /api/camps/export/markdown and /api/camps/export/json.
 * Pure formatting over queryCamps() output. Facts only, quoting the camp where the camp page does;
 * nothing internal (confidence, review notes, hashes, overrides, ids other than the slug).
 */

import type { CampCard, GradeRange, Milestone, PriceTier, Session, SupportFact } from './contract';
import type { CampListing, CampSiteInfo } from '@/lib/db/queries/camps';
import {
  AI_NOTICE,
  AVAILABILITY_LABELS,
  CATEGORY_LABELS,
  SUPPORT_VALUE_LABELS,
  TARGET_SEASON,
  TYPE_LABELS,
  byMilestoneDate,
  campWithProvider,
  formatAges,
  formatDate,
  formatGrades,
  formatPriceRange,
  formatPriceTier,
  isUnconfirmed,
  milestoneLabel,
  milestoneWhen,
  providerLabel,
  upcomingUntil,
} from './display';
import { PUBLIC_API_CORS_HEADERS } from '@/lib/api/publicEventsContract';
import { SITE_URL } from '@/lib/seo/site';
import { getDateStringEastern } from '@/lib/utils/timezone';

export const CAMP_EXPORT_PATHS = {
  markdown: '/api/camps/export/markdown',
  json: '/api/camps/export/json',
} as const;

/**
 * Open CORS like the event exports. The camps change about daily (the refresh cron, Matt's
 * fixes), so the CDN keeps a copy an hour. Not unstable_cache: the full cards are well over the
 * data cache's 2MB entry limit.
 */
export const CAMP_EXPORT_SUCCESS_HEADERS = {
  ...PUBLIC_API_CORS_HEADERS,
  'Cache-Control': 'public, max-age=300, s-maxage=3600, stale-while-revalidate=3600',
};

/** "avlgo-summer-camps-2026-10-29.md", dated in Eastern time. */
export function campExportFilename(extension: 'md' | 'json', now: Date): string {
  return `avlgo-summer-camps-${getDateStringEastern(now)}.${extension}`;
}

/** `attachment`, so the link saves a file a parent can drop into their AI. */
export function campExportDisposition(extension: 'md' | 'json', now: Date): string {
  return `attachment; filename="${campExportFilename(extension, now)}"`;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const campUrl = (slug: string) => `${SITE_URL}/camps/${slug}`;

/** The camp's own text on one line, or null when there is none. */
function clean(text: string | null | undefined): string | null {
  return text?.replace(/\s+/g, ' ').trim() || null;
}

/**
 * The description's first sentence (the contract allows two), at least `minChars` long. A period
 * ends a sentence only before a capital or a digit, and not after an initial or a short title:
 * "staffed by A.C. Reynolds coaches" and "St. Paul's" stay whole.
 */
function firstSentence(description: string, minChars = 0): string | null {
  const text = clean(description);
  if (!text) return null;
  const end = /[.!?](?=\s+["“'‘(]?[A-Z0-9])/g;
  for (let match = end.exec(text); match; match = end.exec(text)) {
    if (match.index < minChars) continue;
    const word = /\S*$/.exec(text.slice(0, match.index))?.[0] ?? '';
    if (match[0] === '.' && ABBREVIATION.test(word)) continue;
    return text.slice(0, match.index + 1);
  }
  return text;
}

const ABBREVIATION = /^(?:[A-Za-z](?:\.[A-Za-z])*|St|Dr|Mt|Mr|Mrs|Ms|Jr|Sr|Ft|No|Rev|vs)$/;

/** As the camp pages show it: to the nearest 5 minutes, never under 5. */
function roundedDrive(minutes: number): number {
  return Math.max(5, Math.round(minutes / 5) * 5);
}

/** Provider, then camp name: a provider's camps sit together. */
function byProviderThenName(a: CampListing, b: CampListing): number {
  return (
    providerLabel(a.providerName).localeCompare(providerLabel(b.providerName)) ||
    a.card.name.localeCompare(b.card.name) ||
    a.slug.localeCompare(b.slug)
  );
}

function sortedSessions(sessions: Session[]): Session[] {
  return [...sessions].sort(
    (a, b) => a.start.localeCompare(b.start) || (a.site ?? '').localeCompare(b.site ?? '')
  );
}

/**
 * The camp's wording on hours, unless it only restates the times ("9AM - 3PM"). The same test
 * as the directory's card.
 */
function hoursNote(text: string | null | undefined): string | null {
  const note = clean(text);
  if (!note) return null;
  const times = /(^|[^a-z])(?:[ap]\.?m\.?|noon)(?![a-z])/gi;
  return /[a-z]/i.test(note.replace(times, '$1')) ? note : null;
}

/** Drop absent values (null, undefined, '', []) so the JSON carries only what the camp states. */
function present<T extends Record<string, unknown>>(record: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(record).filter(
      ([, value]) =>
        value !== null &&
        value !== undefined &&
        value !== '' &&
        !(Array.isArray(value) && value.length === 0)
    )
  ) as Partial<T>;
}

/** A range with both bounds unknown says nothing; otherwise min first (jsonb sorts keys). */
function range<R extends { min: number | null; max: number | null }>(value: R | null): R | null {
  if (!value || (value.min === null && value.max === null)) return null;
  const { min, max, ...rest } = value;
  return { min, max, ...rest } as R;
}

// ---------------------------------------------------------------------------
// Markdown: token-lean (it has to fit a chat app's file limit), one self-contained section per
// camp, read with the header's guide
// ---------------------------------------------------------------------------

/** A camp's summary is cut at a word past this many characters (the AVL GO page has it all). */
const SUMMARY_MAX_CHARS = 100;

function brief(text: string | null): string | null {
  if (!text || text.length <= SUMMARY_MAX_CHARS) return text;
  const cut = text.slice(0, SUMMARY_MAX_CHARS + 1);
  return `${cut.slice(0, cut.lastIndexOf(' ')).replace(/[\s,;:–-]+$/, '')}…`;
}

/** Sessions listed one by one up to this many; a longer schedule is counts and date ranges. */
const MAX_LISTED_SESSIONS = 6;

/** Site names in a long schedule's summary. */
const MAX_SUMMARY_VALUES = 6;

/** "Rising 3rd–5th grade"; "(current grade)" when the camp means this school year's grade. */
function gradesText(grades: GradeRange | null): string | null {
  const text = formatGrades(grades);
  return text && grades?.basis === 'current' ? `${text} (current grade)` : text;
}

function whoText(ages: CampCard['ages'], grades: GradeRange | null): string | null {
  return [formatAges(ages), gradesText(grades)].filter(Boolean).join(' · ') || null;
}

/** "Jun 8–12", "Jun 29 – Jul 3"; the year only when it isn't the summer the camp describes. */
function dateRange(start: string, end: string, summer: number): string {
  const year = start.startsWith(`${summer}-`) ? '' : `, ${start.slice(0, 4)}`;
  if (end === start) return `${formatDate(start)}${year}`;
  if (start.slice(0, 7) === end.slice(0, 7)) {
    return `${formatDate(start)}–${Number(end.slice(8))}${year}`;
  }
  return `${formatDate(start)} – ${formatDate(end)}${year}`;
}

/** "9am", "4:15pm", "noon": shorter than the pages' "9 a.m.", which adds up over 900 camps. */
function shortTime(time: string | null | undefined): string | null {
  const match = time ? /^(\d{2}):(\d{2})$/.exec(time) : null;
  if (!match) return null;
  const hour = Number(match[1]);
  if (hour === 12 && match[2] === '00') return 'noon';
  return `${hour % 12 || 12}${match[2] === '00' ? '' : `:${match[2]}`}${hour < 12 ? 'am' : 'pm'}`;
}

/** "9am–3pm", "from 9am", "until 3pm". */
function shortHours(hours: { start: string | null; end: string | null } | null): string | null {
  if (!hours) return null;
  const start = shortTime(hours.start);
  const end = shortTime(hours.end);
  if (start && end) return `${start}–${end}`;
  if (start) return `from ${start}`;
  return end ? `until ${end}` : null;
}

/** The first start and last end of some sessions. */
function spanOf(sessions: Session[]): { start: string; end: string } | null {
  if (sessions.length === 0) return null;
  return {
    start: sessions.map((session) => session.start).sort()[0],
    end: sessions.map((session) => session.end).sort()[sessions.length - 1],
  };
}

/** A session of 4 to 7 days is a week. */
function isWeekLong(session: Session): boolean {
  const days =
    (Date.parse(`${session.end}T00:00:00Z`) - Date.parse(`${session.start}T00:00:00Z`)) / 86400000 +
    1;
  return days >= 4 && days <= 7;
}

function priceText(price: PriceTier, summer: number): string {
  const notes = [clean(price.label), price.year !== summer && String(price.year)].filter(Boolean);
  return `${formatPriceTier(price)}${notes.length > 0 ? ` (${notes.join('; ')})` : ''}`;
}

/**
 * "Rainbow Community School, Asheville (5 min)": no street address (the camp's AVL GO page has
 * it), the state only outside NC, and a single site's name only when it isn't the provider's.
 */
function siteText(site: CampSiteInfo, provider: string | null): string {
  // Sessions name a camp's sites, so only a camp's one site can go by its town
  const name =
    provider && site.town && site.name.toLowerCase() === provider.toLowerCase() ? null : site.name;
  // The town once: not repeated when it is the site's name (a town estimate)
  const town = site.town && site.town !== name ? site.town : null;
  const state = site.state && site.state.toUpperCase() !== 'NC' ? site.state : null;
  const place = [name, town, state].filter(Boolean).join(', ');
  if (site.driveMinutes === null) return place;
  const drive = roundedDrive(site.driveMinutes);
  return `${place} (${site.driveFromTown === true ? '~' : ''}${drive} min)`;
}

/** Distinct values per kind listed with counts and dates up to this many; past it, a range. */
const MAX_GROUPED_VALUES = 3;

/** The range covering all of these (a missing bound stays open). */
function unionRange(
  ranges: Array<{ min: number | null; max: number | null }>
): { min: number | null; max: number | null } | null {
  if (ranges.length === 0) return null;
  return {
    min: ranges.some((r) => r.min === null) ? null : Math.min(...ranges.map((r) => r.min!)),
    max: ranges.some((r) => r.max === null) ? null : Math.max(...ranges.map((r) => r.max!)),
  };
}

/**
 * A long schedule in one line: "14 weekly sessions; Rainbow Community School: 11, Jun 8 – Jul 31;
 * Firefly Valley Pottery: 3, Aug 3–21". The sites (when there are several), age groups, prices and
 * hours that sessions state for themselves each get a count and date range, or past
 * MAX_GROUPED_VALUES of a kind, one range ("Ages 5–18 (varies)"). A session that states none
 * follows the camp's details.
 */
function sessionSummary(sessions: Session[], card: CampCard, multiSite: boolean): string {
  const noun = sessions.every(isWeekLong) ? 'weekly sessions' : 'sessions';
  const summer = card.season.year;
  const kinds: Array<{
    valueOf: (session: Session) => string | null;
    /** One line for many values of this kind. */
    many: (sessions: Session[]) => string;
  }> = [
    {
      valueOf: (session) => (multiSite ? session.site : null),
      many: (group) => {
        const names = [...new Set(group.map((session) => session.site!))];
        const more = names.length - MAX_SUMMARY_VALUES;
        return `at ${names.slice(0, MAX_SUMMARY_VALUES).join(', ')}${more > 0 ? ` +${more} more` : ''}`;
      },
    },
    {
      valueOf: (session) => whoText(range(session.ages), range(session.grades)),
      many: (group) => {
        const ages = unionRange(group.flatMap((session) => range(session.ages) ?? []));
        const grades = group.flatMap((session) => range(session.grades) ?? []);
        const union = unionRange(grades);
        return `${whoText(ages, union && { ...union, basis: grades[0].basis })} (varies)`;
      },
    },
    {
      valueOf: (session) => (session.price ? priceText(session.price, summer) : null),
      many: (group) =>
        `${formatPriceRange(group.flatMap((session) => session.price ?? []))} (varies)`,
    },
    { valueOf: (session) => shortHours(session.hours), many: () => 'hours vary' },
  ];
  const entries = kinds.flatMap(({ valueOf, many }) => {
    const groups = new Map<string, Session[]>();
    for (const session of sessions) {
      const value = valueOf(session);
      if (value) groups.set(value, [...(groups.get(value) ?? []), session]);
    }
    if (groups.size > MAX_GROUPED_VALUES) return [many([...groups.values()].flat())];
    return [...groups].map(([value, group]) => {
      const span = spanOf(group)!;
      return `${value}: ${group.length}, ${dateRange(span.start, span.end, summer)}`;
    });
  });
  return [`${sessions.length} ${noun}`, ...entries].join('; ');
}

/** A short schedule, each session as "Jun 8–12 (Ages 6–8, $300/week, Full)": no theme labels. */
function sessionList(sessions: Session[], card: CampCard, multiSite: boolean): string {
  return sessions
    .map((session) => {
      const facts = sessionFacts(session, card, multiSite);
      const dates = dateRange(session.start, session.end, card.season.year);
      return facts.length > 0 ? `${dates} (${facts.join(', ')})` : dates;
    })
    .join('; ');
}

/** What a session states for itself: its site (when the camp has several), ages, hours, price. */
function sessionFacts(session: Session, card: CampCard, multiSite: boolean): string[] {
  return [
    multiSite ? session.site : null,
    whoText(range(session.ages), range(session.grades)),
    shortHours(session.hours),
    session.price && priceText(session.price, card.season.year),
    // Last summer's "Full" says nothing about this one
    session.status &&
      session.year === TARGET_SEASON &&
      (AVAILABILITY_LABELS[session.status] ?? session.status),
  ].filter((fact): fact is string => !!fact);
}

/** Back-to-back weeks that state nothing of their own: "6 weekly sessions" says it all. */
function plainWeeks(sessions: Session[], card: CampCard, multiSite: boolean): boolean {
  return (
    sessions.length > 1 &&
    sessions.every(
      (session, index) =>
        isWeekLong(session) &&
        sessionFacts(session, card, multiSite).length === 0 &&
        (index === 0 ||
          Date.parse(session.start) - Date.parse(sessions[index - 1].start) === 7 * 86400000)
    )
  );
}

/**
 * The Registration line's dates: "opens Feb 14, 2027 9am", "Member registration opens Jan 10, 2027
 * (unconfirmed)". A date for 'other' families (scholarships, staff ...) can only be named in the
 * camp's words, and dates worded alike share them: "Scholarships open Jan 1 ... (Jan 1, 2027; Feb
 * 1, 2027)".
 */
function registrationDates(milestones: Milestone[], confirmed: boolean, now: Date): string[] {
  const entries = new Map<string, string[]>();
  for (const milestone of [...milestones].sort(byMilestoneDate)) {
    const when =
      milestone.precision === 'datetime' && milestone.time
        ? `${formatDate(milestone.date, true)} ${shortTime(milestone.time)}`
        : milestoneWhen(milestone);
    const marks = [
      milestone.certainty === 'expected' && 'expected',
      isUnconfirmed(milestone, confirmed) && 'unconfirmed',
      milestone.year !== TARGET_SEASON && `for ${milestone.year}`,
    ].filter(Boolean);
    if (milestone.audience === 'other') {
      const text = clean(milestone.text) ?? 'Some families';
      const date = [when.replace(/^in /, ''), ...marks].join(', ');
      entries.set(text, [...(entries.get(text) ?? []), date]);
      continue;
    }
    // "Registration opens" is just "opens" on the Registration line
    const label = milestoneLabel(milestone, now >= upcomingUntil(milestone)).replace(
      /^Registration /,
      ''
    );
    entries.set(`${label} ${when}${marks.length > 0 ? ` (${marks.join(', ')})` : ''}`, []);
  }
  return [...entries].map(([text, dates]) =>
    dates.length > 0 ? `${text} (${dates.join('; ')})` : text
  );
}

/** "financial aid yes, lunch case by case": the camp's answers; its wording is in the JSON. */
function supportText(card: CampCard): string | null {
  const facts: Array<[string, SupportFact | null]> = [
    ['financial aid', card.financial_aid],
    ['special needs', card.special_needs],
    ['lunch', card.lunch],
    ['transportation', card.transportation],
  ];
  return (
    facts
      .flatMap(([label, fact]) =>
        fact ? [`${label} ${(SUPPORT_VALUE_LABELS[fact.value] ?? fact.value).toLowerCase()}`] : []
      )
      .join(', ') || null
  );
}

/** One camp's Markdown, before it is placed under its provider. */
interface CampSection {
  url: string;
  /** Type, categories, ages and grades. */
  tags: string;
  summary: string | null;
  /** Bullet lines, without "- ". The first is always the summer line. */
  facts: string[];
}

function campSection(camp: CampListing, now: Date): CampSection {
  const { card } = camp;
  const { season } = card;
  const provider = providerLabel(camp.providerName);
  const sessions = sortedSessions(card.sessions);
  const multiSite = camp.sites.length > 1;

  // The summer the facts describe leads, with its dates (the season's, else the sessions')
  const span =
    season.start && season.end ? { start: season.start, end: season.end } : spanOf(sessions);
  const dates = span
    ? dateRange(span.start, span.end, season.year)
    : season.start
      ? `from ${formatDate(season.start)}`
      : null;
  const pending =
    season.year !== TARGET_SEASON && season.status === 'coming_soon'
      ? ` (${TARGET_SEASON} coming soon)`
      : '';
  const long = sessions.length > MAX_LISTED_SESSIONS;
  const weeks = !long && plainWeeks(sessions, card, multiSite);
  const sessionSpan = spanOf(sessions);
  const weeksText =
    weeks &&
    `${sessions.length} weekly sessions${
      sessionSpan && (sessionSpan.start !== span?.start || sessionSpan.end !== span?.end)
        ? `, ${dateRange(sessionSpan.start, sessionSpan.end, season.year)}`
        : ''
    }`;
  const seasonLine = [
    dates,
    clean(season.text),
    long ? sessionSummary(sessions, card, multiSite) : weeksText,
  ]
    .filter(Boolean)
    .join(' · ');
  const list =
    !long && !weeks && sessions.length > 0 ? sessionList(sessions, card, multiSite) : null;

  // The times; the camp's wording only when it doesn't give both
  const note = hoursNote(card.hours?.text);
  const hours =
    card.hours?.start && card.hours.end
      ? shortHours(card.hours)
      : (note && firstSentence(note)) || shortHours(card.hours);
  const care = card.extended_care;
  // "7:30am–5:30pm, $40/week": drop-off from the first time, pickup until the second
  const careText =
    care &&
    ([
      shortHours({ start: care.early_dropoff_start, end: care.late_pickup_end }),
      clean(care.cost_text),
    ]
      .filter(Boolean)
      .join(', ') ||
      'offered');

  const lastYear = card.last_year_registration_opened;
  const registration = [
    ...registrationDates(card.registration, camp.confirmed, now),
    lastYear &&
      `last year opened ${formatDate(lastYear.date, true)}${lastYear.time ? ` ${shortTime(lastYear.time)}` : ''}`,
  ].filter(Boolean);

  // Last summer's availability says nothing about this one
  const availability = season.year === TARGET_SEASON ? card.availability : null;
  const scope = availability && clean(availability.scope);
  const support = supportText(card);

  const facts = [
    `${season.year}${pending}${seasonLine ? `: ${seasonLine}` : ''}`,
    list && `Sessions: ${list}`,
    hours && careText
      ? `Hours: ${hours}; extended care: ${careText}`
      : hours
        ? `Hours: ${hours}`
        : careText && `Extended care: ${careText}`,
    card.prices.length > 0 &&
      `Prices: ${card.prices.map((price) => priceText(price, season.year)).join('; ')}`,
    camp.sites.length > 0 &&
      `${multiSite ? 'Sites' : 'Site'}: ${camp.sites.map((site) => siteText(site, multiSite ? null : provider)).join('; ')}`,
    registration.length > 0 && `Registration: ${registration.join('; ')}`,
    availability &&
      `Availability: ${AVAILABILITY_LABELS[availability.status] ?? availability.status}${
        scope ? ` (${scope})` : ''
      }`,
    support && `Support: ${support}`,
  ].filter((fact): fact is string => !!fact);

  return {
    url: campUrl(camp.slug),
    tags: [
      // A day camp is the default the header names
      card.type === 'day' ? null : (TYPE_LABELS[card.type] ?? card.type),
      card.categories.map((category) => CATEGORY_LABELS[category] ?? category).join(', '),
      whoText(range(card.ages), range(card.grades)),
    ]
      .filter(Boolean)
      .join(' · '),
    summary: brief(firstSentence(card.description)),
    facts,
  };
}

const escapeLinkText = (text: string) => text.replace(/([[\]])/g, '\\$1');

/** A camp's heading, linked to its AVL GO page, then its lines except those its provider shows. */
function campBlock(section: CampSection, heading: string, shown: string[] = []): string {
  return [
    `${heading}](${section.url})`,
    section.tags,
    section.summary,
    ...section.facts.filter((fact) => !shown.includes(fact)).map((fact) => `- ${fact}`),
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * A provider's camps. One camp is a "## [Camp (Provider)](url)" section. Several sit under
 * "## Provider", whose bullets are the lines all of them share (sites, support, registration ...),
 * each camp a "### [Camp](url)" section with the rest.
 */
function providerMarkdown(group: CampListing[], now: Date): string {
  const sections = group.map((camp) => campSection(camp, now));
  if (group.length === 1) {
    const [camp] = group;
    return campBlock(
      sections[0],
      `## [${escapeLinkText(campWithProvider(camp.card.name, camp.providerName))}`
    );
  }
  // Never the summer line: each camp leads with its own
  const shared = sections[0].facts
    .slice(1)
    .filter((fact) => sections.every((section) => section.facts.slice(1).includes(fact)));
  return [
    [`## ${providerLabel(group[0].providerName)}`, ...shared.map((fact) => `- ${fact}`)].join('\n'),
    ...sections.map((section, index) =>
      campBlock(section, `### [${escapeLinkText(group[index].card.name)}`, shared)
    ),
  ].join('\n\n');
}

/** Every camp as one Markdown document: a short header, then the camps by provider. */
export function campsMarkdown(camps: CampListing[], now: Date): string {
  const header = `# Summer camps near Asheville, NC

Every kids' summer camp in AVL GO's directory (${SITE_URL}/camps), sorted by provider. Generated ${getDateStringEastern(now)} · ${camps.length} camps.

Info pulled from each camp's website by AI; double-check with the camp before booking.

How to read it:
- Each camp's first bullet starts with the summer its facts describe. ${TARGET_SEASON} means the camp has posted ${TARGET_SEASON}; ${TARGET_SEASON - 1} means it hasn't yet, so its dates, sessions and prices are ${TARGET_SEASON - 1}'s: a guide, not the ${TARGET_SEASON} schedule.
- Camps are day camps unless the line under the name says otherwise (Half-day, Overnight, Vacation Bible School ...). A provider with several camps has its own heading; the bullets right under it apply to all of its camps.
- A camp with more than ${MAX_LISTED_SESSIONS} sessions gives a count, then each site, age group, price or hours its sessions state, with how many sessions and their date range. "Extended care 7:30am–5:30pm" means drop-off from 7:30, pickup until 5:30.
- Registration dates marked "expected" are the camp's estimate; "unconfirmed" means AVL GO hasn't verified the date.
- Drive times are minutes from downtown Asheville (Pack Square) without traffic, rounded to 5; "~" means estimated from the town's center. Places are in North Carolina unless a state is named.
- "Rising 3rd grade" means entering 3rd grade in the fall after camp; "finished" is the grade just completed. Times are Eastern.
- "Support" is what the camp says about financial aid, special needs, lunch and transportation: yes, case by case or no.
- Each camp's heading links to its AVL GO page: street addresses, session themes, the camp's own wording, and links to its website and registration.

Ask your AI: "Which of these fit a 7- and a 10-year-old the week of July 5 within 30 minutes of downtown?"`;

  // Consecutive camps with the same provider name (two provider rows can share one)
  const groups: CampListing[][] = [];
  for (const camp of [...camps].sort(byProviderThenName)) {
    const last = groups[groups.length - 1];
    if (last && providerLabel(last[0].providerName) === providerLabel(camp.providerName)) {
      last.push(camp);
    } else {
      groups.push([camp]);
    }
  }
  return `${[header, ...groups.map((group) => providerMarkdown(group, now))].join('\n\n')}\n`;
}

// ---------------------------------------------------------------------------
// JSON
// ---------------------------------------------------------------------------

/** What each camp key means: the reader is often an AI with no other docs. */
export const CAMP_EXPORT_FIELDS = {
  type: 'day | half_day | overnight | evening | vbs (Vacation Bible School) | clinic | pre_college',
  categories:
    'Any of arts, music, theater, dance, stem, nature_outdoor, sports, horses, cooking, academic, faith_based, general, special_needs',
  summary: "The first sentence of the camp's description.",
  ages: 'In years; a null bound is open-ended.',
  grades:
    'Numbers: -1 pre-K, 0 kindergarten, 1-12; above 12 means high-school graduates. basis: rising (grade entering in the fall after camp), completed (grade just finished), current (grade this school year) or unspecified.',
  season: `summer: the summer the camp's dates, sessions and prices describe (${TARGET_SEASON}, or an earlier summer when ${TARGET_SEASON} isn't posted yet). status: whether the camp has posted ${TARGET_SEASON} (posted | coming_soon | not_posted).`,
  hours: "HH:MM, 24-hour, Eastern; note is the camp's own wording.",
  extendedCare: 'Before/after care: dropoffFrom and pickupUntil (HH:MM), cost in the camp’s words.',
  prices:
    'amount in US dollars, per week | session | day | program | month | other; label says which price it is; summer only when it differs from season.summer.',
  sites:
    'Where campers are dropped off. driveMinutes: from downtown Asheville (Pack Square) without traffic, rounded to 5. driveFromTown: estimated from the town center, not the site.',
  sessions:
    'Weeks, themes or sessions as the camp lists them. ages, grades, hours and price appear only when they differ from the camp’s; site only when the camp has several.',
  registration:
    'audience: public | member | returning | lottery | resident | early_bird | other (text is the camp’s wording). kind: opens | deadline | lottery_results | closes. date: YYYY-MM-DD, or YYYY-MM when only the month is known; time: HH:MM Eastern. summer: the summer it is for, when not season.summer. expected: the camp’s estimate, not an announced date. unconfirmed: AVL GO hasn’t verified it.',
  lastYearOpened: 'When registration opened for the previous summer.',
  availability:
    "For season.summer. status: available | mixed (some sessions full) | waitlist | full | closed; scope: what it covers; text: the camp's wording.",
  support:
    "financialAid, specialNeeds, lunch, transportation: value yes | case_by_case | no, with the camp's wording.",
  links: "url: the camp's page on AVL GO. website and registrationUrl: the camp's own pages.",
};

function supportRecord(fact: SupportFact | null) {
  return fact ? present({ value: fact.value, text: clean(fact.text) }) : null;
}

function campRecord(camp: CampListing) {
  const { card } = camp;
  const website = card.camp_page_url ?? camp.providerUrl;
  const care = card.extended_care;
  const lastYear = card.last_year_registration_opened;
  const multiSite = camp.sites.length > 1;
  return present({
    name: card.name,
    provider: providerLabel(camp.providerName),
    type: card.type,
    categories: card.categories,
    summary: firstSentence(card.description),
    ages: range(card.ages),
    grades: range(card.grades),
    season: present({
      summer: card.season.year,
      status: card.season.status,
      start: card.season.start,
      end: card.season.end,
      note: clean(card.season.text),
    }),
    hours: card.hours
      ? present({ start: card.hours.start, end: card.hours.end, note: clean(card.hours.text) })
      : null,
    extendedCare: care
      ? present({
          dropoffFrom: care.early_dropoff_start,
          pickupUntil: care.late_pickup_end,
          cost: clean(care.cost_text),
        })
      : null,
    prices: card.prices.map((price) =>
      present({
        amount: price.amount,
        per: price.unit,
        label: clean(price.label),
        summer: price.year !== card.season.year ? price.year : null,
      })
    ),
    sites: camp.sites.map((site) =>
      present({
        name: site.name,
        address: clean(site.address),
        town: site.town,
        state: site.state,
        driveMinutes: site.driveMinutes === null ? null : roundedDrive(site.driveMinutes),
        driveFromTown: site.driveMinutes !== null && site.driveFromTown === true ? true : null,
      })
    ),
    sessions: sortedSessions(card.sessions).map((session) =>
      present({
        start: session.start,
        end: session.end,
        label: clean(session.label),
        site: multiSite ? session.site : null,
        ages: range(session.ages),
        grades: range(session.grades),
        hours: session.hours && present({ start: session.hours.start, end: session.hours.end }),
        price:
          session.price &&
          present({
            amount: session.price.amount,
            per: session.price.unit,
            label: clean(session.price.label),
          }),
        status: session.status,
      })
    ),
    registration: [...card.registration].sort(byMilestoneDate).map((milestone) =>
      present({
        audience: milestone.audience,
        text: milestone.audience === 'other' ? clean(milestone.text) : null,
        kind: milestone.kind,
        date: milestone.precision === 'month' ? milestone.date.slice(0, 7) : milestone.date,
        time: milestone.precision === 'datetime' ? milestone.time : null,
        summer: milestone.year !== card.season.year ? milestone.year : null,
        expected: milestone.certainty === 'expected' ? true : null,
        unconfirmed: isUnconfirmed(milestone, camp.confirmed) ? true : null,
      })
    ),
    lastYearOpened: lastYear ? present({ date: lastYear.date, time: lastYear.time }) : null,
    availability: card.availability
      ? present({
          status: card.availability.status,
          scope: clean(card.availability.scope),
          text: clean(card.availability.text),
        })
      : null,
    financialAid: supportRecord(card.financial_aid),
    specialNeeds: supportRecord(card.special_needs),
    lunch: supportRecord(card.lunch),
    transportation: supportRecord(card.transportation),
    website,
    registrationUrl: card.registration_url !== website ? card.registration_url : null,
    url: campUrl(camp.slug),
  });
}

/** Every camp as one JSON document: { generated, notice, count, fields, camps }. */
export function campsJson(camps: CampListing[], now: Date) {
  return {
    generated: now.toISOString(),
    notice: `${AI_NOTICE} Source: ${SITE_URL}/camps`,
    count: camps.length,
    fields: CAMP_EXPORT_FIELDS,
    camps: [...camps].sort(byProviderThenName).map((camp) => campRecord(camp)),
  };
}
