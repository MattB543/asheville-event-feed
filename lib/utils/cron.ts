/**
 * Shared helpers for cron routes.
 *
 * These were previously copy-pasted into each cron route (formatDuration in 5,
 * chunk in 2). Kept dependency-free so route modules can import them without
 * pulling in anything else.
 */

// Format a millisecond duration for log output (e.g. "850ms", "42s", "3m 7s")
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

// Split an array into fixed-size batches
export const chunk = <T>(arr: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
    arr.slice(i * size, i * size + size)
  );
