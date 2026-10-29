import { getDateStringEastern } from '@/lib/utils/timezone';

/** Camp id -> the Eastern day this browser last counted a view of it. */
const VIEWED_KEY = 'avlgo:camps:viewed';

/**
 * Count one view of a camp from this browser (01 §4.5): opening its page and clicking out to its
 * website are the same number, counted once per camp per Eastern day. Call it from an effect or a
 * click, never during render, so crawlers rarely count. The server rate-limits per IP as well.
 */
export function sendCampView(campId: string): void {
  const today = getDateStringEastern(new Date());
  let seen: Record<string, string> = {};
  try {
    seen = JSON.parse(localStorage.getItem(VIEWED_KEY) ?? '{}') as Record<string, string>;
  } catch {
    // Unreadable: count this one; the server's rate limit still applies.
  }
  if (seen[campId] === today) return;

  // Only today's entries matter, so older ones are dropped as the map is rewritten
  const next = Object.fromEntries(Object.entries(seen).filter(([, day]) => day === today));
  next[campId] = today;
  try {
    localStorage.setItem(VIEWED_KEY, JSON.stringify(next));
  } catch {
    // Not remembered: a reload may count again, within the server's limit.
  }
  // keepalive lets the request finish when the click navigates away
  void fetch(`/api/camps/${campId}/view`, { method: 'POST', keepalive: true }).catch(() => {});
}
