/**
 * Facebook Browser-Based GraphQL Module
 *
 * Makes GraphQL API calls from within the browser context.
 * This works because the browser has valid session cookies and tokens.
 */

import type { Page } from 'patchright';
import { log } from './facebook-stealth';

// Result from browser evaluate (before url is added)
interface BrowserEvaluateResult {
  eventId: string;
  title: string | null;
  description: string | null;
  startTimestamp: number | null;
  endTimestamp: number | null;
  location: string | null;
  imageUrl: string | null;
  organizer: string | null;
  price: string | null;
  interestedCount: number | null;
  goingCount: number | null;
  zip: string | null;
  latitude: number | null;
  longitude: number | null;
}

// Final event details with url added
export interface FacebookEventDetails extends BrowserEvaluateResult {
  url: string;
}

interface FacebookGraphQLHostEntry {
  host?: { name?: string };
  user_type_renderer?: { host?: { name?: string } };
}

interface FacebookGraphQLFriendsCard {
  event_connected_users_maybe?: { count?: number };
  event_connected_users_going?: { count?: number };
  unified_associates_count?: number;
  unified_member_count?: number;
}

interface FacebookGraphQLCoverMediaRenderer {
  cover_photo?: { photo?: { full_image?: { uri?: string } } };
  cover_media?: Array<{ full_image?: { uri?: string } }>;
}

interface FacebookGraphQLEventPlace {
  name?: string;
  location?: { latitude?: number; longitude?: number };
  address?: { street?: string };
}

interface FacebookGraphQLEvent {
  name?: string;
  start_timestamp?: number;
  end_timestamp?: number;
  event_place?: FacebookGraphQLEventPlace;
  cover_media_renderer?: FacebookGraphQLCoverMediaRenderer;
  price_info?: { summary?: string };
  event_description?: { text?: string };
  one_line_address?: string;
  event_creator?: { name?: string };
  event_hosts_that_can_view_guestlist?: Array<{ name?: string }>;
  event_hosts_meet_your_host?: FacebookGraphQLHostEntry[];
  can_view_friends_card?: { event?: FacebookGraphQLFriendsCard };
}

interface FacebookGraphQLLine {
  data?: { event?: FacebookGraphQLEvent };
}

type BrowserGraphQLResult = BrowserEvaluateResult | { error: string };

/**
 * Fetch event details using GraphQL from within the browser context
 */
export async function fetchEventDetailsInBrowser(
  page: Page,
  eventId: string
): Promise<FacebookEventDetails | null> {
  try {
    const result = await page.evaluate<BrowserGraphQLResult, string>(async (eventId: string) => {
      // Extract tokens from page
      let fb_dtsg = '',
        lsd = '',
        jazoest = '',
        rev = '',
        userId = '';

      const scripts = document.querySelectorAll('script');
      const html = document.documentElement.innerHTML;

      for (const script of scripts) {
        const text = script.textContent || '';
        const dtsgMatch = text.match(/\["DTSGInitData",\[\],\{"token":"([^"]+)"/);
        if (dtsgMatch && !fb_dtsg) fb_dtsg = dtsgMatch[1];
        const lsdMatch = text.match(/\["LSD",\[\],\{"token":"([^"]+)"/);
        if (lsdMatch && !lsd) lsd = lsdMatch[1];
        const revMatch = text.match(/"server_revision":(\d+)/);
        if (revMatch && !rev) rev = revMatch[1];
        const userMatch = text.match(/"USER_ID":"(\d+)"/);
        if (userMatch && !userId) userId = userMatch[1];
      }

      const jazoestMatch = html.match(/"jazoest":"(\d+)"/) || html.match(/jazoest=(\d+)/);
      if (jazoestMatch) jazoest = jazoestMatch[1];

      if (!fb_dtsg || !lsd) {
        return { error: 'Could not extract tokens' };
      }

      // Fetch header data (title, date, location, image)
      const headerParams = new URLSearchParams();
      headerParams.append('av', userId);
      headerParams.append('__user', userId);
      headerParams.append('__a', '1');
      headerParams.append('__rev', rev);
      headerParams.append('__comet_req', '15');
      headerParams.append('fb_dtsg', fb_dtsg);
      headerParams.append('jazoest', jazoest);
      headerParams.append('lsd', lsd);
      headerParams.append('fb_api_caller_class', 'RelayModern');
      headerParams.append('fb_api_req_friendly_name', 'EventCometPermalinkHeaderQuery');
      headerParams.append(
        'variables',
        JSON.stringify({ eventID: eventId, isCrawler: false, scale: 1 })
      );
      headerParams.append('doc_id', '24852752747670056');

      // Fetch about data (description, organizer)
      const aboutParams = new URLSearchParams();
      aboutParams.append('av', userId);
      aboutParams.append('__user', userId);
      aboutParams.append('__a', '1');
      aboutParams.append('__rev', rev);
      aboutParams.append('__comet_req', '15');
      aboutParams.append('fb_dtsg', fb_dtsg);
      aboutParams.append('jazoest', jazoest);
      aboutParams.append('lsd', lsd);
      aboutParams.append('fb_api_caller_class', 'RelayModern');
      aboutParams.append('fb_api_req_friendly_name', 'PublicEventCometAboutRootQuery');
      aboutParams.append(
        'variables',
        JSON.stringify({ eventID: eventId, isLoggedOut: false, scale: 1 })
      );
      aboutParams.append('doc_id', '24522924877384967');

      const [headerRes, aboutRes] = await Promise.all([
        fetch('https://www.facebook.com/api/graphql/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-FB-LSD': lsd },
          body: headerParams.toString(),
          credentials: 'include',
        }),
        fetch('https://www.facebook.com/api/graphql/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-FB-LSD': lsd },
          body: aboutParams.toString(),
          credentials: 'include',
        }),
      ]);

      const [headerText, aboutText] = await Promise.all([headerRes.text(), aboutRes.text()]);

      // Parse responses
      let title: string | null = null;
      let startTimestamp: number | null = null;
      let endTimestamp: number | null = null;
      let location: string | null = null;
      let imageUrl: string | null = null;
      let price: string | null = null;
      let description: string | null = null;
      let organizer: string | null = null;
      let interestedCount: number | null = null;
      let goingCount: number | null = null;
      let zip: string | null = null;
      let latitude: number | null = null;
      let longitude: number | null = null;

      // Parse header response
      const headerLines = headerText.split('\n').filter((l) => l.trim());
      for (const line of headerLines) {
        try {
          const parsed = JSON.parse(line) as FacebookGraphQLLine;
          if (parsed?.data?.event) {
            const event = parsed.data.event;
            title = event.name || null;
            startTimestamp = event.start_timestamp || null;
            endTimestamp = event.end_timestamp || null;

            if (event.event_place?.name) {
              location = event.event_place.name;
            }

            // Handle different cover media types
            const coverRenderer = event.cover_media_renderer;
            if (coverRenderer) {
              // EventCoverPhotoRenderer - single cover photo
              if (coverRenderer.cover_photo?.photo?.full_image?.uri) {
                imageUrl = coverRenderer.cover_photo.photo.full_image.uri;
              }
              // EventMultiCoverMediaRenderer - multiple cover images, take first
              else if (
                Array.isArray(coverRenderer.cover_media) &&
                coverRenderer.cover_media[0]?.full_image?.uri
              ) {
                imageUrl = coverRenderer.cover_media[0].full_image.uri;
              }
            }

            if (event.price_info?.summary) {
              price = event.price_info.summary;
            }
          }
        } catch {}
      }

      // Parse about response
      const aboutLines = aboutText.split('\n').filter((l) => l.trim());
      for (const line of aboutLines) {
        try {
          const parsed = JSON.parse(line) as FacebookGraphQLLine;
          if (parsed?.data?.event) {
            const event = parsed.data.event;

            if (event.event_description?.text) {
              description = event.event_description.text;
            }

            // Extract location data from About query (has lat/lon and full address)
            if (event.event_place?.location) {
              const loc = event.event_place.location;
              if (typeof loc.latitude === 'number') latitude = loc.latitude;
              if (typeof loc.longitude === 'number') longitude = loc.longitude;
            }

            // Extract zip from one_line_address (e.g., "777 Haywood Rd, Asheville, NC 28806")
            if (event.one_line_address && !zip) {
              const zipMatch = event.one_line_address.match(/\b(\d{5})(?:-\d{4})?\b/);
              if (zipMatch) {
                zip = zipMatch[1];
              }
              // Also use one_line_address as location if we don't have one
              if (!location) {
                location = event.one_line_address;
              }
            }

            // For Page-type venues, check address.street
            if (event.event_place?.address?.street && !location) {
              location = event.event_place.address.street;
            }

            // Try multiple sources for organizer name
            if (!organizer && event.event_creator?.name) {
              organizer = event.event_creator.name;
            }

            // Fallback: event_hosts_that_can_view_guestlist
            if (!organizer && Array.isArray(event.event_hosts_that_can_view_guestlist)) {
              const host = event.event_hosts_that_can_view_guestlist[0];
              if (host?.name) {
                organizer = host.name;
              }
            }

            // Fallback: event_hosts_meet_your_host
            if (!organizer && Array.isArray(event.event_hosts_meet_your_host)) {
              const hostEntry = event.event_hosts_meet_your_host[0];
              // Can be in hostEntry.host.name or hostEntry.user_type_renderer.host.name
              if (hostEntry?.host?.name) {
                organizer = hostEntry.host.name;
              } else if (hostEntry?.user_type_renderer?.host?.name) {
                organizer = hostEntry.user_type_renderer.host.name;
              }
            }
          }

          // Extract interested/going counts from can_view_friends_card
          // Note: can_view_friends_card is inside data.event, not data directly
          if (parsed?.data?.event?.can_view_friends_card?.event) {
            const friendsCard = parsed.data.event.can_view_friends_card.event;
            // "Interested" count (event_connected_users_maybe)
            if (friendsCard.event_connected_users_maybe?.count !== undefined) {
              interestedCount = friendsCard.event_connected_users_maybe.count;
            }
            // "Going" count (event_connected_users_going)
            if (friendsCard.event_connected_users_going?.count !== undefined) {
              goingCount = friendsCard.event_connected_users_going.count;
            }
            // Also check unified counts as fallback
            if (interestedCount === null && friendsCard.unified_associates_count !== undefined) {
              interestedCount = friendsCard.unified_associates_count;
            }
            if (goingCount === null && friendsCard.unified_member_count !== undefined) {
              goingCount = friendsCard.unified_member_count;
            }
          }
        } catch {}
      }

      return {
        eventId,
        title,
        description,
        startTimestamp,
        endTimestamp,
        location,
        imageUrl,
        organizer,
        price,
        interestedCount,
        goingCount,
        zip,
        latitude,
        longitude,
      };
    }, eventId);

    if ('error' in result) {
      log(`    ⚠️ Error fetching ${eventId}: ${result.error}`);
      return null;
    }

    if (!result.title) {
      return null;
    }

    return {
      ...result,
      url: `https://www.facebook.com/events/${eventId}/`,
    } as FacebookEventDetails;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`    ⚠️ Error fetching ${eventId}: ${errorMessage}`);
    return null;
  }
}

/**
 * Fetch details for multiple events with rate limiting
 */
export async function fetchAllEventDetailsInBrowser(
  page: Page,
  eventIds: string[],
  options: {
    concurrency?: number;
    delayMs?: number;
    onProgress?: (completed: number, total: number) => void;
  } = {}
): Promise<FacebookEventDetails[]> {
  const { concurrency = 3, delayMs = 500, onProgress } = options;
  const results: FacebookEventDetails[] = [];
  let completed = 0;

  log(
    `📡 Fetching details for ${eventIds.length} events in browser (concurrency: ${concurrency})...`
  );

  // Process in batches
  for (let i = 0; i < eventIds.length; i += concurrency) {
    const batch = eventIds.slice(i, i + concurrency);

    const batchResults = await Promise.all(
      batch.map(async (eventId) => {
        const event = await fetchEventDetailsInBrowser(page, eventId);
        completed++;
        onProgress?.(completed, eventIds.length);
        return event;
      })
    );

    for (const result of batchResults) {
      if (result) {
        results.push(result);
      }
    }

    // Small delay between batches
    if (i + concurrency < eventIds.length) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  log(`✅ Fetched ${results.length}/${eventIds.length} events successfully`);
  return results;
}
