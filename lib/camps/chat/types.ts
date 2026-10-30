/**
 * Shared contract for the /camps AI chat (docs/camps/06-ai-chat-plan.md §3). Types and constants
 * only, so the client bundle can import it: every camps/DB import here is `import type`.
 *
 * Nothing private (override, hash, confidence, review_notes, sources) ever reaches the model or
 * the browser: the Public* types below are what leaves the server.
 */
import type {
  CampCard,
  CampCategory,
  CampType,
  Hours,
  Milestone,
  PriceTier,
  Site,
  AvailabilityStatus,
} from '@/lib/camps/contract';
import type {
  CampCardData,
  KidFit,
  RegistrationLine,
  RegistrationStatus,
  SupportKey,
} from '@/lib/camps/display';

export const CAMP_CHAT_ENDPOINT = '/api/camps/chat';
export const CAMP_SEARCH_PAGE_SIZE = 20;
export const CAMP_MAX_TOOL_CALLS = 6;
export const CAMP_MAX_PLANNING_ROUNDS = 4;

export type ChatMessage = { role: 'user' | 'assistant'; content: string };

/** Facts a camp may not state; includeUnknown lets a search keep camps missing them. */
export type UnknownFact = 'dates' | 'hours' | 'price' | 'location';

export type WhereOp =
  | 'eq'
  | 'ne'
  | 'lte'
  | 'gte'
  | 'contains'
  | 'not_contains'
  | 'exists'
  | 'missing';

/** One generic predicate on a registered public card path (lib/camps/chat/fields.ts). */
export interface WhereClause {
  path: string;
  op: WhereOp;
  value: string | null;
}

/** The normalized search_camps arguments. Null means "no filter"; it never inherits. */
export interface CampSearchFilters {
  keywords: string[] | null;
  keywordMatch: 'all' | 'any';
  excludeKeywords: string[] | null;
  kids: Array<{ age: number | null; grade: number | null }> | null;
  kidsMode: 'any' | 'each' | 'same_session';
  dates: { start: string; end: string; match: 'overlaps' | 'covers' } | null;
  dropoffBy: string | null;
  pickupAtOrAfter: string | null;
  dayLength: 'full' | 'half' | null;
  price: { min: number | null; max: number | null; per: 'week' | 'session' } | null;
  maxDriveMinutes: number | null;
  near: { place: string; maxMiles: number } | null;
  towns: string[] | null;
  types: CampType[] | null;
  categories: CampCategory[] | null;
  needs: SupportKey[] | null;
  registration: Extract<RegistrationStatus, 'open' | 'soon' | 'not_announced' | 'full'> | null;
  registrationOpens: { from: string | null; to: string | null; audience: 'public' | 'any' } | null;
  where: WhereClause[] | null;
  includeUnknown: UnknownFact[] | null;
  page: number;
}

export type PublicMilestone = Omit<Milestone, 'confidence'> & { unconfirmed: boolean };
export type PublicCampSite = Site & { driveMinutes: number | null; driveFromTown: boolean };
export type PublicCampCard = Omit<
  CampCard,
  'confidence' | 'review_notes' | 'sources' | 'registration' | 'sites'
> & { provider: string; registration: PublicMilestone[]; sites: PublicCampSite[] };

/** One session (or the season fallback) at one site that passed every filter. */
export interface CampSessionMatch {
  label: string | null;
  start: string | null;
  end: string | null;
  year: number | null;
  projectedStart: string | null;
  projectedEnd: string | null;
  site: string | null;
  town: string | null;
  driveMinutes: number | null;
  driveFromTown: boolean;
  distance: { miles: number; estimated: boolean } | null;
  hours: Hours;
  price: PriceTier | null;
  comparedPrice: { amount: number; per: 'week' | 'session' } | null;
  kidFit: KidFit | null;
  kidIndexes: number[]; // zero-based children this example supports
  status: AvailabilityStatus | null;
  unknown: UnknownFact[];
  caveats: string[];
}

export type CampSearchHit = Pick<
  CampCardData,
  | 'id'
  | 'slug'
  | 'name'
  | 'providerName'
  | 'summary'
  | 'who'
  | 'season'
  | 'price'
  | 'priceNote'
  | 'hours'
  | 'hoursNote'
  | 'care'
  | 'location'
  | 'drive'
  | 'support'
  | 'websiteUrl'
> & {
  type: CampType;
  categories: CampCategory[];
  url: string;
  registrationUrl: string | null;
  checkedAt: string | null;
  seasonYear: number;
  seasonStatus: CampCard['season']['status'];
  registration: RegistrationLine; // default/public version, not earliestOpening
  openingDates: PublicMilestone[]; // target-summer openings, audience/wording intact
  lastYearOpened: CampCard['last_year_registration_opened'];
  matchedSessions: number;
  totalSessions: number;
  matches: CampSessionMatch[]; // <= 6; witness for every child in each mode
  keywordHits: Array<{ term: string; field: string; text: string }>;
  unknown: UnknownFact[];
  caveats: string[];
};

export interface CampSearchSummary {
  filters: CampSearchFilters;
  totalMatches: number;
  page: number;
  hasMore: boolean;
}

export interface CampSearchResult extends CampSearchSummary {
  unknownCounts: Partial<Record<UnknownFact, number>>;
  notes: string[];
  camps: CampSearchHit[];
}

export interface CampDetail {
  hit: CampSearchHit;
  card: PublicCampCard;
}

export interface CampDetailsResult {
  camps: CampDetail[];
  notFound: string[];
}

/** What one provider attempt verified; sent to the browser as the campResults frame. */
export interface CampTurnEvidence {
  lastSearch: CampSearchFilters | null;
  searches: CampSearchSummary[]; // requested search first, then alternatives
  camps: CampSearchHit[]; // unique slugs verified in this provider attempt
}

export type CampChatFrame = { type: 'campResults'; data: CampTurnEvidence };

export interface CampChatRequest {
  messages: ChatMessage[];
  directory: string;
  lastSearch: CampSearchFilters | null;
}

/** The directory's URL filters (CampDirectory's listKey), read as chat context. */
export interface DirectoryContext {
  lines: string[];
  args: Partial<CampSearchFilters>;
  notes: string[];
}

export interface CampToolSession {
  execute(name: string, args: unknown): Promise<CampSearchResult | CampDetailsResult>;
  snapshot(): CampTurnEvidence;
}
