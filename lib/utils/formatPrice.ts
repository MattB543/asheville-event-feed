/**
 * Format a price value to a rounded dollar string.
 * - 0 or "0" => "Free"
 * - null/undefined/empty => "Unknown"
 * - numeric => "$X" (rounded to nearest dollar)
 */
export function formatPrice(value: number | string | null | undefined): string {
  // Handle null/undefined/empty
  if (value === null || value === undefined || value === "" || value === "null") {
    return "Unknown";
  }

  // Convert to number if string
  const numValue = typeof value === "string" ? parseFloat(value) : value;

  // Handle NaN
  if (isNaN(numValue)) {
    return "Unknown";
  }

  // Handle free
  if (numValue === 0) {
    return "Free";
  }

  // Round to nearest dollar
  const rounded = Math.round(numValue);

  return `$${rounded}`;
}
