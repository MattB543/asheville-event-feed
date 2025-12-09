export type EventSource = 'AVL_TODAY' | 'EVENTBRITE' | 'MEETUP' | 'FACEBOOK' | 'HARRAHS' | 'ORANGE_PEEL' | 'GREY_EAGLE' | 'LIVE_MUSIC_AVL' | 'EXPLORE_ASHEVILLE';

export interface ScrapedEvent {
  sourceId: string;
  source: EventSource;
  title: string;
  description?: string;
  startDate: Date;
  location?: string;
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
    address?: { city: string };
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
