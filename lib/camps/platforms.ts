/**
 * Registration platforms camps use, by host. Two jobs:
 *   - a registration date may be verified on the camp's own domain or on its own account on one
 *     of these platforms (plan §4.3: never on a third-party listing);
 *   - a platform host is never a merge key: one host serves many unrelated camps (plan §6.2).
 */

const REGISTRATION_PLATFORMS: Record<string, RegExp> = {
  WebTrac: /(?:^|\.)myvscloud\.com$/,
  Jackrabbit: /(?:^|\.)jackrabbitclass\.com$/,
  iClassPro: /(?:^|\.)iclasspro\.com$/,
  CampDoc: /(?:^|\.)campdoc\.com$/,
  UltraCamp: /(?:^|\.)ultracamp\.com$/,
  CampBrain: /(?:^|\.)campbrainregistration\.com$|(?:^|\.)campbrain\.com$/,
  CampMinder: /(?:^|\.)campintouch\.com$|(?:^|\.)campminder\.com$/,
  Regpack: /(?:^|\.)regpack\.com$/,
  Sawyer: /(?:^|\.)hisawyer\.com$/,
  Amilia: /(?:^|\.)amilia\.com$/,
  ActiveNet: /(?:^|\.)activecommunities\.com$|(?:^|\.)active\.com$/,
  RecDesk: /(?:^|\.)recdesk\.com$/,
  Doubleknot: /(?:^|\.)doubleknot\.com$/,
  PlayMetrics: /(?:^|\.)playmetrics\.com$/,
  SportsEngine: /(?:^|\.)sportngin\.com$|(?:^|\.)sportsengine\.com$/,
  Ryzer: /(?:^|\.)ryzer\.com$/,
  Qgiv: /(?:^|\.)qgiv\.com$/,
  Jotform: /(?:^|\.)jotform\.com$/,
  GoogleForms: /^docs\.google\.com$|^forms\.gle$/,
  Eventbrite: /(?:^|\.)eventbrite\.com$/,
  Procare: /(?:^|\.)procareconnect\.com$|(?:^|\.)procaresoftware\.com$/,
  Brightwheel: /(?:^|\.)mybrightwheel\.com$/,
  Tandem: /(?:^|\.)tandem\.co$/,
  Square: /(?:^|\.)square\.site$|(?:^|\.)squareup\.com$/,
  MySchoolBucks: /(?:^|\.)myschoolbucks\.com$/,
  Smartwaiver: /(?:^|\.)smartwaiver\.com$/,
  Daxko: /(?:^|\.)daxko\.com$/,
  CampSite: /(?:^|\.)campsite\.com$/,
  Subsplash: /(?:^|\.)subsplash\.com$/,
  ChurchCenter: /(?:^|\.)churchcenter\.com$/,
};

/**
 * Where one host serves many accounts, the account is in the path or query: a link to one Google
 * Form or Ryzer event says nothing about another on the same host.
 */
const TENANT_PATTERNS: RegExp[] = [
  /docs\.google\.com\/forms\/d\/(?:e\/)?([\w-]+)/,
  /forms\.gle\/([\w-]+)/,
  /jotform\.com\/(?:form\/)?(\d+)/,
  /ryzer\.com\/.*[?&]id=(\d+)/,
  /jackrabbitclass\.com\/.*[?&](?:id|orgid)=(\d+)/i,
  /qgiv\.com\/for\/([\w-]+)/,
  /campdoc\.com\/.*[?&]r=([\w-]+)/,
  /eventbrite\.com\/e\/[\w-]*?(\d{6,})/,
  /ultracamp\.com\/.*[?&]idCamp=(\d+)/i,
  /activecommunities\.com\/([\w-]+)\//,
  /portal\.iclasspro\.com\/([\w-]+)/,
  /hisawyer\.com\/([\w-]+)/,
  /amilia\.com\/store\/\w+\/([\w-]+)/,
  /subsplash\.com\/([\w+-]+)/,
];

/** Platforms that put the account in the subdomain ("campgreenville.campintouch.com"). */
const SUBDOMAIN_ACCOUNT_HOSTS =
  /^[\w-]+\.(?:campintouch\.com|myvscloud\.com|recdesk\.com|campbrainregistration\.com|sportngin\.com|square\.site|churchcenter\.com)$/;

/** Provider-owned social pages: accepted for VBS only, labeled and hand-checked (plan N9). */
const SOCIAL_HOSTS = /(?:^|\.)(?:facebook\.com|fb\.me|fb\.com|instagram\.com)$/;

/** Site builders' shared domains: a page there proves nothing about who owns another one. */
const SHARED_SITE_HOSTS =
  /(?:^|\.)(?:squarespace\.com|wixsite\.com|myshopify\.com|weebly\.com|wordpress\.com|godaddysites\.com|square\.site)$/;

export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * "camps.ymcawnc.org" -> "ymcawnc.org". Good enough for the domains camps use (no .co.uk). On a
 * site builder's shared domain the whole host is the identity ("foo.wixsite.com").
 */
export function registrableDomain(url: string): string | null {
  const host = hostOf(url);
  if (!host) return null;
  if (SHARED_SITE_HOSTS.test(host)) return host;
  return host.split('.').slice(-2).join('.');
}

export function platformOf(url: string): string | null {
  const host = hostOf(url);
  if (!host) return null;
  for (const [name, pattern] of Object.entries(REGISTRATION_PLATFORMS)) {
    if (pattern.test(host)) return name;
  }
  return null;
}

/**
 * The platform account a URL belongs to: the account id where the host is shared
 * ("register.ryzer.com#309477"), the host where the account is the subdomain
 * ("campgreenville.campintouch.com"), or null when we can't tell, which never authorizes anything.
 */
export function platformTenant(url: string): string | null {
  const host = hostOf(url);
  if (!host || !platformOf(url)) return null;
  for (const pattern of TENANT_PATTERNS) {
    const match = url.match(pattern);
    if (match?.[1]) return `${host}#${match[1]}`;
  }
  return SUBDOMAIN_ACCOUNT_HOSTS.test(host) ? host : null;
}

/** Distinct platform names among a page's links. */
export function detectPlatforms(hrefs: string[]): string[] {
  const found = new Set<string>();
  for (const href of hrefs) {
    const platform = platformOf(href);
    if (platform) found.add(platform);
  }
  return [...found].sort();
}

export function isSocialUrl(url: string): boolean {
  const host = hostOf(url);
  return !!host && SOCIAL_HOSTS.test(host);
}
