/**
 * Registration platforms camps use, by host. Two jobs:
 *   - a registration date may be verified on the camp's own domain or on one of these hosts
 *     (plan §4.3: never on a third-party listing);
 *   - a platform host is never a merge key: one host serves many unrelated camps (plan §6.2).
 */

export const REGISTRATION_PLATFORMS: Record<string, RegExp> = {
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

/** Provider-owned social pages: accepted for VBS only, labeled and hand-checked (plan N9). */
export const SOCIAL_HOSTS = /(?:^|\.)(?:facebook\.com|fb\.me|fb\.com|instagram\.com)$/;

export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** "camps.ymcawnc.org" -> "ymcawnc.org". Good enough for the domains camps use (no .co.uk). */
export function registrableDomain(url: string): string | null {
  const host = hostOf(url);
  if (!host) return null;
  const parts = host.split('.');
  return parts.slice(-2).join('.');
}

export function platformOf(url: string): string | null {
  const host = hostOf(url);
  if (!host) return null;
  for (const [name, pattern] of Object.entries(REGISTRATION_PLATFORMS)) {
    if (pattern.test(host)) return name;
  }
  return null;
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
