// Round a price string to the nearest dollar ("$19.10" -> "$19", "$25.50" -> "$26")
export function formatPriceDisplay(price: string | null | undefined): string {
  if (!price || price === 'Unknown') return '$ Unknown';
  if (price.toLowerCase() === 'free') return 'Free';

  const match = price.match(/\$?([\d.]+)/);
  if (match) {
    const rounded = Math.round(parseFloat(match[1]));
    return `$${rounded}`;
  }
  // A bare "$" with no number is as good as unknown
  if (price.trim() === '$') return '$ Unknown';
  return price;
}
