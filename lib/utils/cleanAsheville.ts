/**
 * Removes redundant "Asheville" or "Asheville, NC" references from AI summaries.
 * Since the venue/location is already displayed separately, we don't need it in the summary.
 */
export function cleanAshevilleFromSummary(text: string): string {
  if (!text) return text;

  return (
    text
      // ", Asheville, NC" or ", Asheville" (most common)
      .replace(/, Asheville,? NC?\b/gi, ",")
      .replace(/, Asheville\b(?!, NC)/gi, ",")
      // " in Asheville, NC" or " in Asheville"
      .replace(/ in Asheville,? NC?\b/gi, "")
      .replace(/ in Asheville\b(?!, NC)/gi, "")
      // "(Asheville, NC)" or "(Asheville)" at end of parenthetical
      .replace(/,? Asheville,? NC?\)/gi, ")")
      // Clean up any double commas or comma-space-comma that might result
      .replace(/,\s*,/g, ",")
      // Clean up ", )" that might result
      .replace(/,\s*\)/g, ")")
      // Clean up any trailing commas before periods
      .replace(/,\s*\./g, ".")
  );
}
