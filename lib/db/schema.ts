import { pgTable, text, timestamp, boolean, uuid, index, integer } from 'drizzle-orm/pg-core';

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
  interestedCount: integer('interested_count'), // Facebook: "maybe" / interested count
  goingCount: integer('going_count'),           // Facebook: going count
  timeUnknown: boolean('time_unknown').default(false), // True if source only provided date, no time
  // Recurring event fields (for daily recurring like art installations)
  recurringType: text('recurring_type'), // 'daily' | null - daily events shown separately in UI
  recurringEndDate: timestamp('recurring_end_date', { withTimezone: true }), // When the recurring event ends
}, (table) => ({
  startDateIdx: index('events_start_date_idx').on(table.startDate),
  sourceIdx: index('events_source_idx').on(table.source),
  // GIN index for efficient tag array queries (e.g., filtering by tags)
  tagsIdx: index('events_tags_idx').using('gin', table.tags),
}));

// Submitted events table for user-submitted event suggestions
export const submittedEvents = pgTable('submitted_events', {
  id: uuid('id').defaultRandom().primaryKey(),

  // Event details (similar to main events table)
  title: text('title').notNull(),
  description: text('description'),
  startDate: timestamp('start_date', { withTimezone: true }).notNull(),
  endDate: timestamp('end_date', { withTimezone: true }),
  location: text('location'),
  organizer: text('organizer'),
  price: text('price'),
  url: text('url'),  // Link to original event page (optional)
  imageUrl: text('image_url'),

  // Submission metadata
  submitterEmail: text('submitter_email'),  // Optional contact
  submitterName: text('submitter_name'),    // Optional name
  notes: text('notes'),                      // Additional context from submitter

  // Review status
  status: text('status').default('pending').notNull(),  // 'pending' | 'approved' | 'rejected'
  reviewedAt: timestamp('reviewed_at'),

  // Tracking
  createdAt: timestamp('created_at').defaultNow().notNull(),
  source: text('source').default('form').notNull(),  // 'form' | 'api'
}, (table) => ({
  statusIdx: index('submitted_events_status_idx').on(table.status),
  createdAtIdx: index('submitted_events_created_at_idx').on(table.createdAt),
}));
