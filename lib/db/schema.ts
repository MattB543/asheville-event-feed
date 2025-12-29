import { pgTable, text, timestamp, boolean, uuid, index, integer, jsonb, vector, uniqueIndex } from 'drizzle-orm/pg-core';

export const events = pgTable('events', {
  id: uuid('id').defaultRandom().primaryKey(),
  sourceId: text('source_id').notNull(), // ID from the source (e.g., "12345")
  source: text('source').notNull(),      // "AVL_TODAY" | "EVENTBRITE"
  title: text('title').notNull(),
  description: text('description'),
  startDate: timestamp('start_date', { withTimezone: true }).notNull(),
  location: text('location'),
  zip: text('zip'),                      // Zip code for the event location
  organizer: text('organizer'),
  price: text('price'),                  // Stored as string for display: "$20.00", "Free"
  url: text('url').unique().notNull(),   // Unique constraint to prevent duplicates
  imageUrl: text('image_url'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),      // Set when event data changes
  lastSeenAt: timestamp('last_seen_at').defaultNow(),   // Set every time scraper sees this event
  hidden: boolean('hidden').default(false), // Admin moderation flag
  tags: text('tags').array(), // Array of strings for tags
  interestedCount: integer('interested_count'), // Facebook: "maybe" / interested count
  goingCount: integer('going_count'),           // Facebook: going count
  timeUnknown: boolean('time_unknown').default(false), // True if source only provided date, no time
  // Recurring event fields (for daily recurring like art installations)
  recurringType: text('recurring_type'), // 'daily' | null - daily events shown separately in UI
  recurringEndDate: timestamp('recurring_end_date', { withTimezone: true }), // When the recurring event ends
  // User engagement
  favoriteCount: integer('favorite_count').default(0), // Number of users who favorited this event
  // AI-generated fields for semantic search
  aiSummary: text('ai_summary'), // 1-2 sentence structured summary from Azure AI
  embedding: vector('embedding', { dimensions: 1536 }), // Gemini embedding of "${title}: ${aiSummary}"
  // Event quality scoring (AI-generated, 0-30 total)
  score: integer('score'),                    // Total: rarity + unique + magnitude (0-30)
  scoreRarity: integer('score_rarity'),       // 0-10: How rare/urgent is this event
  scoreUnique: integer('score_unique'),       // 0-10: How cool/novel is this event
  scoreMagnitude: integer('score_magnitude'), // 0-10: Production scale/talent level
  scoreReason: text('score_reason'),          // One-sentence AI reasoning for the score
}, (table) => ({
  startDateIdx: index('events_start_date_idx').on(table.startDate),
  sourceIdx: index('events_source_idx').on(table.source),
  // GIN index for efficient tag array queries (e.g., filtering by tags)
  tagsIdx: index('events_tags_idx').using('gin', table.tags),
  // HNSW index for fast cosine similarity vector search
  embeddingIdx: index('events_embedding_idx').using('hnsw', table.embedding.op('vector_cosine_ops')),
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

// User preferences for authenticated users
// Synced from localStorage when user logs in
export const userPreferences = pgTable('user_preferences', {
  // Uses Supabase auth.users UUID
  userId: uuid('user_id').primaryKey(),

  // Content filtering preferences
  blockedHosts: text('blocked_hosts').array().default([]),     // Organizers to hide
  blockedKeywords: text('blocked_keywords').array().default([]), // Keywords to hide
  hiddenEvents: jsonb('hidden_events').default([]),            // Array of {title, organizer} fingerprints
  useDefaultFilters: boolean('use_default_filters').default(true),

  // User engagement
  favoritedEventIds: text('favorited_event_ids').array().default([]), // Event IDs

  // Optional: Filter settings (date, price, tags, etc.)
  // Stored as JSON for flexibility
  filterSettings: jsonb('filter_settings'),

  // Email digest preferences
  emailDigestFrequency: text('email_digest_frequency').default('none'), // 'none' | 'daily' | 'weekly'
  emailDigestLastSentAt: timestamp('email_digest_last_sent_at'), // When last digest was sent
  emailDigestTags: text('email_digest_tags').array().default([]), // Optional: only include events with these tags

  // Tracking
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Newsletter settings (independent from live feed filters)
export const newsletterSettings = pgTable('newsletter_settings', {
  userId: uuid('user_id').primaryKey(), // Supabase auth.users UUID
  frequency: text('frequency').default('none').notNull(), // 'none' | 'daily' | 'weekly'
  weekendEdition: boolean('weekend_edition').default(false).notNull(), // Daily only
  scoreTier: text('score_tier').default('all').notNull(), // 'all' | 'top50' | 'top10'
  filters: jsonb('filters'), // Stored newsletter filter settings (JSON)
  curatorUserIds: uuid('curator_user_ids').array().default([]), // Curators to include
  lastSentAt: timestamp('last_sent_at', { withTimezone: true }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Curator profiles for the Curate feature
export const curatorProfiles = pgTable('curator_profiles', {
  userId: uuid('user_id').primaryKey(), // matches Supabase auth.users
  slug: text('slug').unique().notNull(), // e.g., "john-abc123"
  displayName: text('display_name').notNull(),
  bio: text('bio'), // nullable, max 500 chars
  isPublic: boolean('is_public').default(false).notNull(),
  showProfilePicture: boolean('show_profile_picture').default(false).notNull(),
  avatarUrl: text('avatar_url'), // stored from auth provider when showProfilePicture is enabled
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  slugIdx: index('curator_profiles_slug_idx').on(table.slug),
}));

// Curated events for the Curate feature
export const curatedEvents = pgTable('curated_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => curatorProfiles.userId, { onDelete: 'cascade' }),
  eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
  note: text('note'), // nullable, max 280 chars
  curatedAt: timestamp('curated_at').defaultNow().notNull(),
}, (table) => ({
  userEventUnique: uniqueIndex('curated_events_user_event_unique').on(table.userId, table.eventId),
  userIdIdx: index('curated_events_user_id_idx').on(table.userId),
  eventIdIdx: index('curated_events_event_id_idx').on(table.eventId),
}));
