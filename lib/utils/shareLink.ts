export type ShareOutcome = 'shared' | 'copied' | 'cancelled' | 'failed';

export async function copyLink(url: string): Promise<ShareOutcome> {
  try {
    await navigator.clipboard.writeText(url);
    return 'copied';
  } catch {
    return 'failed';
  }
}

/**
 * The native share sheet on touch devices, copy-the-link everywhere else.
 * Desktop browsers have navigator.share too, but there the OS sheet is a detour
 * from what people expect a desktop "Share" to do.
 */
export async function shareLink(url: string, title: string): Promise<ShareOutcome> {
  const touch = window.matchMedia('(pointer: coarse)').matches;
  if (touch && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, url });
      return 'shared';
    } catch (error) {
      // Dismissing the sheet is not a failure
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
    }
  }
  return copyLink(url);
}
