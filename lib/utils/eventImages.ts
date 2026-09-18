/**
 * What counts as a real event image.
 *
 * Several columns look populated but carry no information about the event:
 * the static `/asheville-default.jpg` the AI cron batch-applies to anything
 * with no image, and the generic group/fallback artwork some sources hand out
 * in place of a poster. Anything on this list must be treated as "no image" by
 * code that decides whether an event still needs one - otherwise a placeholder
 * blocks a real poster from ever landing.
 */

/** Static placeholder the AI cron's images pass applies. */
export const DEFAULT_EVENT_IMAGE = '/asheville-default.jpg';

/** Substrings that mark a source's generic stand-in rather than event artwork. */
const PLACEHOLDER_URL_PARTS = ['/images/fallbacks/', 'group-cover', 'default_photo'];

/** True when `imageUrl` is artwork for this specific event. */
export function hasRealEventImage(imageUrl: string | null | undefined): boolean {
  if (!imageUrl) return false;
  if (imageUrl === DEFAULT_EVENT_IMAGE) return false;
  return !PLACEHOLDER_URL_PARTS.some((part) => imageUrl.includes(part));
}
