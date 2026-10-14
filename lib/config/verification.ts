/**
 * Verification policy constants shared with code that shouldn't load the
 * verifier itself (it pulls in the AI clients), such as scrapers.
 */

/**
 * A stored description shorter than this counts as missing: it makes an event
 * eligible for verification, and only then may verification replace it. A
 * longer one is the source's own text and is never overwritten (until
 * 2026-10-14 the AI never saw the stored description and replaced full scraped
 * ones with shorter paraphrases).
 */
export const THIN_DESCRIPTION_LENGTH = 50;
