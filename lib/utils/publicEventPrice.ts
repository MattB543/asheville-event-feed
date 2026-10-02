/**
 * Conservative numeric price for public structured data (schema.org Offer.price).
 *
 * Returns a plain numeric USD string ("0", "15", "12.5") only when the stored price
 * string unambiguously names one price. Anything else - missing, "Unknown",
 * donation-based, ranges like "$15-25", or descriptive text - returns undefined,
 * so callers omit the claim rather than publish a wrong number.
 */
export function parsePublicOfferPrice(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const s = value.trim();
  if (!s) return undefined;

  if (/^free$/i.test(s)) return '0';

  const m = s.match(/^(?:\$\s*)?(\d{1,6}(?:,\d{3})*(?:\.\d{1,2})?)(?:\s*USD)?$/i);
  if (!m) return undefined;

  const n = Number(m[1].replace(/,/g, ''));
  if (!Number.isFinite(n) || n < 0) return undefined;
  return String(n);
}
