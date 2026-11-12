import { generateEventSlug } from '@/lib/utils/slugify';
import { formatDateEastern } from '@/lib/utils/timezone';

type Listed = { id: string; title: string; startDate: Date; timeUnknown: boolean | null };

/** What every holiday page says about an event: its page, time and day */
export const eventHref = (e: Listed) => `/events/${generateEventSlug(e.title, e.startDate, e.id)}`;

export const eventTime = (e: Listed) =>
  e.timeUnknown ? null : formatDateEastern(e.startDate, { hour: 'numeric', minute: '2-digit' });

export const longDay = (d: Date) =>
  formatDateEastern(d, { weekday: 'long', month: 'long', day: 'numeric' });

/** Earliest first, with the id breaking ties so the order never shifts between renders */
export const byTime = (a: Listed, b: Listed) =>
  a.startDate.getTime() - b.startDate.getTime() || a.id.localeCompare(b.id);
