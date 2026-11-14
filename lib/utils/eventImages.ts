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

/** The public Storage bucket holding our own copies of event images */
export const EVENT_IMAGES_BUCKET = 'event-images';

/** Facebook CDN image links, which stop working a few weeks after they're issued */
export const FACEBOOK_CDN_LIKE = '%.fbcdn.net/%';
/** Our own copies of Facebook images, which last */
export const FACEBOOK_COPY_FOLDER = 'facebook';
export const FACEBOOK_COPY_LIKE = `%/${EVENT_IMAGES_BUCKET}/${FACEBOOK_COPY_FOLDER}/%`;

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

/**
 * A real image another site can show. Mountain Xpress refuses image requests from
 * other sites, so its posters load nowhere but its own pages.
 */
export function hasLoadableEventImage(imageUrl: string | null | undefined): imageUrl is string {
  return hasRealEventImage(imageUrl) && !imageUrl!.includes('mountainx.com');
}
