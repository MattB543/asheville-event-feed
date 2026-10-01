/**
 * Library system names by calendar host. LIBRARY events carry the branch as
 * organizer, so the event page's "View on <system>" link label is looked up
 * from the event URL instead. Kept in step with SYSTEMS in
 * lib/scrapers/library.ts; scripts/scrapers/test-library.ts fails if an event's
 * URL doesn't resolve here.
 */
const LIBRARY_SYSTEM_HOSTS: Array<[RegExp, string]> = [
  [/^buncombe\.librarycalendar\.com$/, 'Buncombe County Public Libraries'],
  [/^transylvaniacounty\.librarycalendar\.com$/, 'Transylvania County Library'],
  [/^hendersonpl\.libcal\.com$/, 'Henderson County Public Library'],
  [/^mcdowellpubliclibrary\.libcal\.com$/, 'McDowell County Public Library'],
  [/^polklibrary\.libcal\.com$/, 'Polk County Public Libraries'],
  [/^(www\.)?haywoodcountync\.gov$/, 'Haywood County Public Library'],
  // WhoFi serves each branch from its own subdomain (madison-marshall-nc, ...)
  [/^madison-[a-z-]+\.whofi\.com$/, 'Madison County Public Libraries'],
];

export function getLibrarySystemName(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
  return LIBRARY_SYSTEM_HOSTS.find(([pattern]) => pattern.test(host))?.[1];
}
