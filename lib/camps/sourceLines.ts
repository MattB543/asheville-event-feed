/**
 * What the camps refresh compares to decide whether a provider's pages changed
 * (lib/camps/refresh.ts): the lines that can carry a camp fact, each as a short hash, kept per page.
 *
 * Before 2026-11-19 the refresh hashed every page's final URL and full text, and only about one
 * "pages changed" in five was a change to a camp fact. The rest were login tokens in redirect URLs
 * (CampInTouch, Active), text that differs on every read (a math captcha, a countdown, a shuffled
 * photo carousel), text that differs every day (a page printing today's date, "open today until
 * 5", a home page's event list) and news widgets. Each false alarm cost a model call and rewrote
 * the provider's cards.
 *
 * So: no URLs in the hash, and no order (a carousel or a reordered menu changes nothing). A line
 * counts only when it could state a fact a parent reads: it names camp or registration (STRONG),
 * or it has a date, a price, a time, an age or grade, or a status word (WEAK). A WEAK line is
 * hashed together with the STRONG line just above it, when there is one, so "January 12" under
 * "Returning families" and under "New families" are different lines. On a site's home page a WEAK
 * line counts only with such a line above it, since that's where event lists and news live. Lines
 * about the moment of reading are dropped.
 *
 * It errs toward re-extracting: a changed line that might matter is a change. What it can miss is
 * a fact on a line with none of these words or numbers ("Lunch is provided").
 */
import { createHash } from 'node:crypto';

export interface FactLine {
  /** First 12 hex characters of a sha1: what's stored and compared. */
  hash: string;
  /** The normalized line, for the run log and the model. */
  text: string;
}

const MONTH =
  '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';

/** Names camp, summer or signing up: counts on every page. "campus" isn't camp. */
const STRONG =
  /camp(?!us)|summer|\bvbs\b|vacation bible|regist|enrol|sign[- ]?ups?\b|wait[- ]?list|sold out|tuition|\bsessions?\b|scholarship|financial aid/;

/** A date, a price, a time of day, an age or grade, or a word about status or cost. */
const WEAK = new RegExp(
  [
    `\\b${MONTH}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?\\b`, // June 14, June 14th
    `\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH}\\b`, // 14 June
    `\\b${MONTH}\\.?,?\\s+20\\d\\d\\b`, // June 2027
    `\\b\\d{1,2}/\\d{1,2}(?:/\\d{2,4})?\\b`, // 6/14
    `\\b2027\\b`,
    `\\$\\s?\\d`,
    `\\b\\d{1,2}(?::\\d\\d)?\\s?(?:a\\.?m\\b|p\\.?m\\b)`,
    `\\bages?\\b|\\bgrades?\\b|\\byears? old\\b|\\brising\\b|\\bpre-?k\\b`,
    `\\bfull\\b|\\bclosed?\\b|\\bopen(?:s|ed|ing)?\\b|\\bavailable\\b|\\bspots?\\b|\\bdeadline\\b|\\bdeposit\\b|\\bfees?\\b|\\bcosts?\\b|\\bweeks?\\b`,
  ].join('|')
);

/**
 * Text about the moment the page was read: "open today until 5", "posted 3 hours ago", a countdown
 * ("12 days 4 hours 33 minutes"). A line about registration is kept whatever it says ("Registration
 * opens tomorrow, January 5 at 9 AM").
 */
const VOLATILE =
  /\b(?:today|tonight|tomorrow|yesterday)\b|\bago\b|\b\d+\s*(?:days?|hrs?|hours?)\b.*\b\d+\s*(?:min(?:ute)?s?|sec(?:ond)?s?)\b/;
const ABOUT_REGISTRATION = /regist|enrol|sign[- ]?ups?\b|wait[- ]?list|sold out|deadline/;

/** A copyright line or a bare email address: "camp" in a camp's own name makes these look STRONG. */
const BOILERPLATE = /^(?:©|\(c\)|copyright\b)|^\S+@\S+\.\S+$/;

// Long lines are split into sentences, so one changed sentence isn't a whole changed paragraph
const LONG_LINE_CHARS = 240;
// A WEAK line belongs to the STRONG line this many lines above it, at most
const LABEL_REACH = 3;
// A WEAK line this short is a bare value, and the line above this short may be its heading
const BARE_VALUE_CHARS = 40;
const HEADING_CHARS = 80;

const MONTH_NAMES = [
  ['january', 'jan'],
  ['february', 'feb'],
  ['march', 'mar'],
  ['april', 'apr'],
  ['may', 'may'],
  ['june', 'jun'],
  ['july', 'jul'],
  ['august', 'aug'],
  ['september', 'sept?'],
  ['october', 'oct'],
  ['november', 'nov'],
  ['december', 'dec'],
];

/** Every way a page prints the date `day` (YYYY-MM-DD), with an optional weekday before it. */
function dateWritten(day: string): RegExp {
  const [year, month, date] = day.split('-').map(Number);
  const [full, short] = MONTH_NAMES[month - 1];
  const name = `(?:${full}|${short})\\.?`;
  const ordinal = `0?${date}(?:st|nd|rd|th)?`;
  const yy = `(?:${year}|${String(year).slice(2)})`;
  const weekday = '(?:(?:mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?|sun)(?:day)?\\.?,?\\s+)?';
  return new RegExp(
    `${weekday}(?:${name}\\s+${ordinal}(?:,?\\s+${year})?|${ordinal}\\s+${name}(?:,?\\s+${year})?|\\b0?${month}/0?${date}(?:/${yy})?\\b|\\b${year}-${String(month).padStart(2, '0')}-${String(date).padStart(2, '0')})`,
    'g'
  );
}

function normalize(line: string): string {
  return line
    .toLowerCase()
    .replace(/[  -​]/g, ' ')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function shortHash(text: string): string {
  return createHash('sha1').update(text).digest('hex').slice(0, 12);
}

/**
 * The fact lines of one page's text. `today` (YYYY-MM-DD, Eastern) drops lines that are nothing
 * but today's date (a registration system printing it); a line that says more keeps its date, so
 * "Registration opens January 12" reads the same on January 12 as on any other day. `homePage`:
 * a WEAK line counts only under a STRONG one.
 */
export function factLines(
  text: string,
  options: { today: string; homePage?: boolean }
): FactLine[] {
  const today = dateWritten(options.today);
  const lines = new Map<string, string>();
  let label = '';
  let sinceLabel = Infinity;
  // The line before, when it's short enough to be a heading or a table cell
  let above = '';
  for (const raw of text.split('\n')) {
    const pieces = raw.length > LONG_LINE_CHARS ? raw.split(/(?<=[.!?])\s+/) : [raw];
    for (const piece of pieces) {
      const line = normalize(piece);
      if (line.length < 3) continue;
      sinceLabel += 1;
      if (BOILERPLATE.test(line)) continue;
      if (VOLATILE.test(line) && !ABOUT_REGISTRATION.test(line)) continue;
      // Only today's date (and perhaps the time): the page printing when it was read
      const undated = line.replace(today, '');
      if (undated !== line && undated.replace(/[^a-z]/g, '').length < 3) continue;

      if (STRONG.test(line)) {
        lines.set(shortHash(line), line);
        label = line;
        sinceLabel = 0;
      } else if (WEAK.test(line)) {
        const labeled = sinceLabel <= LABEL_REACH;
        if (options.homePage && !labeled) continue;
        // A bare value ("January 5", "$350") under a plain heading ("Returning families") is
        // hashed with that heading, so the same dates under swapped headings read as a change
        const bare = !labeled && line.length <= BARE_VALUE_CHARS && above !== '';
        lines.set(
          shortHash(labeled ? `${label}\n${line}` : bare ? `${above}\n${line}` : line),
          line
        );
      }
      above = line.length <= HEADING_CHARS ? line : '';
    }
  }
  return [...lines].map(([hash, line]) => ({ hash, text: line }));
}

/** One hash for a stored baseline, for the provider's `source_hash` column and the logs. */
export function hashLines(entries: string[]): string | null {
  if (entries.length === 0) return null;
  return createHash('sha256').update(entries.join('\n')).digest('hex');
}

/** A site's home page: the path is empty or "/". */
export function isHomePage(url: string): boolean {
  try {
    const { pathname, search } = new URL(url);
    return (pathname === '' || pathname === '/') && search === '';
  } catch {
    return false;
  }
}

/** A short id for the page a line was read on: its requested URL, never the redirect's. */
export function pageId(url: string): string {
  return createHash('sha1').update(url.split('#')[0]).digest('hex').slice(0, 8);
}

// ---------------------------------------------------------------------------
// The stored baseline (camp_providers.source_lines): "<page>:<hash>" for a line read on a page,
// "~<hash>" for a line seen on one of two back-to-back reads but not the other (a rotating list,
// a random testimonial), which is never again taken for a change.
// ---------------------------------------------------------------------------

export interface Baseline {
  lines: Array<{ page: string; hash: string }>;
  unstable: Set<string>;
  /** Every hash in it, stable or not. */
  known: Set<string>;
}

// Bounds on what one provider stores. Lines come newest first (writeBaseline's callers pass the
// pages just read before the ones carried over), so what's cut is the oldest carried-over page;
// a site that is random on every read keeps the same 500 unstable hashes rather than churning.
const MAX_LINES = 5000;
const MAX_UNSTABLE = 500;

export function readBaseline(stored: string[]): Baseline {
  const lines: Baseline['lines'] = [];
  const unstable = new Set<string>();
  for (const entry of stored) {
    if (entry.startsWith('~')) unstable.add(entry.slice(1));
    else {
      const [page, hash] = entry.split(':');
      if (hash) lines.push({ page, hash });
    }
  }
  return { lines, unstable, known: new Set([...lines.map((line) => line.hash), ...unstable]) };
}

export function writeBaseline(
  lines: Iterable<{ page: string; hash: string }>,
  unstable: Set<string>
): string[] {
  const entries = new Set<string>();
  for (const { page, hash } of lines) {
    if (entries.size >= MAX_LINES) break;
    if (!unstable.has(hash)) entries.add(`${page}:${hash}`);
  }
  for (const hash of [...unstable].sort().slice(0, MAX_UNSTABLE)) entries.add(`~${hash}`);
  return [...entries].sort();
}
