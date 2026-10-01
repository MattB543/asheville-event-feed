/**
 * Coarse Asheville/Buncombe test for regional outlets whose feeds cover all of
 * western NC. It only has to drop the obviously out-of-area stories - the AI
 * layer still judges each article - so it errs toward keeping anything that
 * names a Buncombe place. Lives in a subdirectory so the test runner's
 * `--all` does not load it as a source.
 */

/**
 * Buncombe County's towns and communities, plus Asheville institutions that
 * stand in for the city. "Asheville Highway" runs through Transylvania and
 * Henderson counties, so it does not count.
 */
const BUNCOMBE_PLACES =
  /\b(asheville(?! highway| hwy)|buncombe|black mountain|swannanoa|weaverville|woodfin|montreat|biltmore|candler|leicester|fairview|arden|enka|barnardsville|skyland|oteen|montford|river arts district|unca|a-b tech|mission hospital|warren wilson)\b/i;

/** True if any of the texts (title, dek, lede, URL slug...) names a Buncombe place. */
export function mentionsBuncombe(...texts: Array<string | undefined>): boolean {
  return BUNCOMBE_PLACES.test(texts.filter(Boolean).join(' '));
}

/**
 * Outlets based in Buncombe that have no module of their own. Their
 * headline-only items often name no place ("Showing riverside resilience, High
 * Five Coffee makes another comeback" is a Woodfin story), so Google News keeps
 * them anyway and enrichment presumes they're local.
 */
export const BUNCOMBE_OUTLETS = [
  'citizen-times.com',
  'blackmountainnews.com',
  'ashevegashotsheet.substack.com',
  'avltoday.6amcity.com',
  'ashvegas.com',
  'thevalleyecho.com',
];
