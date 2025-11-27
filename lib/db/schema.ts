import { pgTable, text, timestamp, boolean, uuid } from 'drizzle-orm/pg-core';

export const events = pgTable('events', {
  id: uuid('id').defaultRandom().primaryKey(),
  sourceId: text('source_id').notNull(), // ID from the source (e.g., "12345")
  source: text('source').notNull(),      // "AVL_TODAY" | "EVENTBRITE"
  title: text('title').notNull(),
  description: text('description'),
  startDate: timestamp('start_date', { withTimezone: true }).notNull(),
  location: text('location'),
  organizer: text('organizer'),
  price: text('price'),                  // Stored as string for display: "$20.00", "Free"
  url: text('url').unique().notNull(),   // Unique constraint to prevent duplicates
  imageUrl: text('image_url'),
  createdAt: timestamp('created_at').defaultNow(),
  hidden: boolean('hidden').default(false), // Admin moderation flag
  tags: text('tags').array(), // Array of strings for tags
});
