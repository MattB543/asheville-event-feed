export type EventSource = 'AVL_TODAY' | 'EVENTBRITE' | 'MEETUP' | 'FACEBOOK' | 'HARRAHS' | 'ORANGE_PEEL' | 'GREY_EAGLE' | 'LIVE_MUSIC_AVL' | 'EXPLORE_ASHEVILLE' | 'MISFIT_IMPROV' | 'UDHARMA' | 'NC_STAGE' | 'STORY_PARLOR' | 'MOUNTAIN_X';

export interface ScrapedEvent {
  sourceId: string;
  source: EventSource;
  title: string;
  description?: string;
  startDate: Date;
  location?: string;
  zip?: string;
  organizer?: string;
  price?: string;
  url: string;
  imageUrl?: string;
  interestedCount?: number; // Facebook: "maybe" / interested count
  goingCount?: number;      // Facebook: going count
  timeUnknown?: boolean;    // True if source only provided date, no time
  // Recurring event fields
  recurringType?: 'daily';  // Daily recurring events shown separately in UI
  recurringEndDate?: Date;  // When the recurring event ends
}

export interface ScrapedEventWithTags extends ScrapedEvent {
  tags?: string[];
}

export interface AvlTodayResponse {
  Value: Array<{
    Id: string;
    Name: string;
    Description: string;
    DateStart: string;
    Venue: string;
    CityState: string;
    Address?: string;        // Street address (e.g., "697 D Haywood Rd")
    Zip?: string;            // Zip code (e.g., "28806")
    latitude?: number;
    longitude?: number;
    Price: number | string | null;
    Links: Array<{ url: string }>;
    TicketUrl: string;
    LargeImg: string;
    MediumImg: string;
    PId?: string;
    StartUTC?: string;
  }>;
}

export interface EventbriteApiEvent {
  id: string;
  name: string | { text: string };
  summary?: string | { text: string };
  start?: { local: string; timezone?: string };
  start_date?: string;
  start_time?: string;
  timezone?: string;
  url: string;
  image?: { original?: { url: string }; url?: string };
  primary_venue?: {
    name: string;
    address?: {
      city: string;
      region?: string;           // State (e.g., "NC")
      country?: string;          // Country code (e.g., "US")
      postal_code?: string;      // Zip code (e.g., "28801")
      address_1?: string;        // Street address
      address_2?: string;        // Unit/suite
      latitude?: string;
      longitude?: string;
    };
  };
  primary_organizer?: { name: string };
  ticket_availability?: {
    is_free: boolean;
    minimum_ticket_price?: {
      display: string;
      major_value: string | null;
    };
  };
}

export interface EventbriteResponse {
  events: EventbriteApiEvent[];
}

export interface MeetupApiEvent {
  id: string;
  title: string;
  description?: string;
  dateTime: string;
  endTime?: string;
  eventType?: string;
  eventUrl: string;
  isAttending?: boolean;
  isSaved?: boolean;
  rsvpState?: string;
  maxTickets?: number;
  featuredEventPhoto?: {
    id?: string;
    baseUrl?: string;
    highResUrl?: string;
  };
  feeSettings?: {
    amount?: number;
    currency?: string;
  };
  group?: {
    id?: string;
    name?: string;
    urlname?: string;
    city?: string;
    state?: string;
    country?: string;
    isPrivate?: boolean;
  };
}

export interface MeetupGraphQLResponse {
  data?: {
    recommendedEvents?: {
      pageInfo: {
        hasNextPage: boolean;
        endCursor: string | null;
      };
      edges: Array<{
        node: MeetupApiEvent;
      }>;
    };
  };
  errors?: Array<{ message: string }>;
}
