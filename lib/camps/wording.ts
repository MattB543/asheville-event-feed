/**
 * Wording rules shared by verification (lib/camps/verify.ts) and display (lib/camps/display.ts).
 * Pure: no fetching, safe to import from client components.
 */

/**
 * "Registration is expected to open in mid-December": a date the camp hasn't committed to, so
 * never a reminder. The extraction schema has no certainty field yet (pilot finding, report §8.2).
 */
const TENTATIVE_WORDING =
  /\b(?:expect|expected|expects|tentative|tentatively|anticipat\w*|plans? to|estimated|approximately|should open|likely|hope to)\b|\bmid-/i;

export function isTentativeWording(text: string): boolean {
  return TENTATIVE_WORDING.test(text);
}
