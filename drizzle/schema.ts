import { pgTable, index, uuid, text, timestamp, boolean, jsonb, integer, vector, unique, uniqueIndex, foreignKey } from "drizzle-orm/pg-core"



export const submittedEvents = pgTable("submitted_events", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	title: text().notNull(),
	description: text(),
	startDate: timestamp("start_date", { withTimezone: true, mode: 'string' }).notNull(),
	endDate: timestamp("end_date", { withTimezone: true, mode: 'string' }),
	location: text(),
	organizer: text(),
	price: text(),
	url: text(),
	imageUrl: text("image_url"),
	submitterEmail: text("submitter_email"),
	submitterName: text("submitter_name"),
	notes: text(),
	status: text().default('pending').notNull(),
	reviewedAt: timestamp("reviewed_at", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	source: text().default('form').notNull(),
}, (table) => [
	index("submitted_events_created_at_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamp_ops")),
	index("submitted_events_status_idx").using("btree", table.status.asc().nullsLast().op("text_ops")),
]);

export const newsletterSettings = pgTable("newsletter_settings", {
	userId: uuid("user_id").primaryKey().notNull(),
	frequency: text().default('none').notNull(),
	weekendEdition: boolean("weekend_edition").default(false).notNull(),
	scoreTier: text("score_tier").default('all').notNull(),
	filters: jsonb(),
	curatorUserIds: uuid("curator_user_ids").array().default([""]),
	lastSentAt: timestamp("last_sent_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
	daySelection: text("day_selection").default('everyday').notNull(),
	selectedDays: integer("selected_days").array().default([]),
});

export const userPreferences = pgTable("user_preferences", {
	userId: uuid("user_id").primaryKey().notNull(),
	blockedHosts: text("blocked_hosts").array().default([""]),
	blockedKeywords: text("blocked_keywords").array().default([""]),
	hiddenEvents: jsonb("hidden_events").default([]),
	useDefaultFilters: boolean("use_default_filters").default(true),
	favoritedEventIds: text("favorited_event_ids").array().default([""]),
	filterSettings: jsonb("filter_settings"),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
	emailDigestFrequency: text("email_digest_frequency").default('none'),
	emailDigestLastSentAt: timestamp("email_digest_last_sent_at", { mode: 'string' }),
	emailDigestTags: text("email_digest_tags").array().default([""]),
	positiveSignals: jsonb("positive_signals").default([]),
	negativeSignals: jsonb("negative_signals").default([]),
	positiveCentroid: vector("positive_centroid", { dimensions: 1536 }),
	negativeCentroid: vector("negative_centroid", { dimensions: 1536 }),
	centroidUpdatedAt: timestamp("centroid_updated_at", { mode: 'string' }),
});

export const curatorProfiles = pgTable("curator_profiles", {
	userId: uuid("user_id").primaryKey().notNull(),
	slug: text().notNull(),
	displayName: text("display_name").notNull(),
	bio: text(),
	isPublic: boolean("is_public").default(false).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
	showProfilePicture: boolean("show_profile_picture").default(false).notNull(),
	avatarUrl: text("avatar_url"),
	title: text(),
	isVerified: boolean("is_verified").default(false).notNull(),
	verifiedAt: timestamp("verified_at", { withTimezone: true, mode: 'string' }),
	verifiedBy: uuid("verified_by"),
}, (table) => [
	index("curator_profiles_slug_idx").using("btree", table.slug.asc().nullsLast().op("text_ops")),
	unique("curator_profiles_slug_unique").on(table.slug),
]);

export const cronJobRuns = pgTable("cron_job_runs", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	jobName: text("job_name").notNull(),
	status: text().notNull(),
	startedAt: timestamp("started_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	completedAt: timestamp("completed_at", { withTimezone: true, mode: 'string' }),
	durationMs: integer("duration_ms"),
	result: jsonb(),
}, (table) => [
	index("cron_job_runs_job_name_idx").using("btree", table.jobName.asc().nullsLast().op("text_ops")),
	index("cron_job_runs_started_at_idx").using("btree", table.startedAt.asc().nullsLast().op("timestamptz_ops")),
]);

export const curatedEvents = pgTable("curated_events", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	eventId: uuid("event_id").notNull(),
	note: text(),
	curatedAt: timestamp("curated_at", { mode: 'string' }).defaultNow().notNull(),
	scoreBoost: jsonb("score_boost"),
}, (table) => [
	index("curated_events_event_id_idx").using("btree", table.eventId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("curated_events_user_event_unique").using("btree", table.userId.asc().nullsLast().op("uuid_ops"), table.eventId.asc().nullsLast().op("uuid_ops")),
	index("curated_events_user_id_idx").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.eventId],
			foreignColumns: [events.id],
			name: "curated_events_event_id_events_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [curatorProfiles.userId],
			name: "curated_events_user_id_curator_profiles_user_id_fk"
		}).onDelete("cascade"),
]);

export const events = pgTable("events", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	sourceId: text("source_id").notNull(),
	source: text().notNull(),
	title: text().notNull(),
	description: text(),
	startDate: timestamp("start_date", { withTimezone: true, mode: 'string' }).notNull(),
	location: text(),
	zip: text(),
	organizer: text(),
	price: text(),
	url: text().notNull(),
	imageUrl: text("image_url"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	hidden: boolean().default(false),
	tags: text().array(),
	interestedCount: integer("interested_count"),
	goingCount: integer("going_count"),
	timeUnknown: boolean("time_unknown").default(false),
	recurringType: text("recurring_type"),
	recurringEndDate: timestamp("recurring_end_date", { withTimezone: true, mode: 'string' }),
	favoriteCount: integer("favorite_count").default(0),
	aiSummary: text("ai_summary"),
	embedding: vector({ dimensions: 1536 }),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
	lastSeenAt: timestamp("last_seen_at", { mode: 'string' }).defaultNow(),
	score: integer(),
	scoreRarity: integer("score_rarity"),
	scoreUnique: integer("score_unique"),
	scoreMagnitude: integer("score_magnitude"),
	scoreReason: text("score_reason"),
	lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true, mode: 'string' }),
	scoreOverride: jsonb("score_override"),
	scoreAshevilleWeird: integer("score_asheville_weird"),
	scoreSocial: integer("score_social"),
}, (table) => [
	index("events_embedding_idx").using("hnsw", table.embedding.asc().nullsLast().op("vector_cosine_ops")),
	index("events_source_idx").using("btree", table.source.asc().nullsLast().op("text_ops")),
	index("events_start_date_idx").using("btree", table.startDate.asc().nullsLast().op("timestamptz_ops")),
	index("events_tags_idx").using("gin", table.tags.asc().nullsLast().op("array_ops")),
	unique("events_url_unique").on(table.url),
]);
