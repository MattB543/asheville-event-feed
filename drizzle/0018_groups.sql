-- Group Directory: one row per recurring community group (/groups, /groups/[slug]).
--
-- Rows are seeded from the committed data/groups/directory.json by
-- scripts/groups/seed-groups.ts, keyed by directory_key so a re-seed updates in
-- place and never touches `hidden`.
--
-- There is deliberately no events.group_id column and no join table: a group's
-- events are matched at read time by match_keys (lib/groups/matchKeys.ts), so
-- nothing has to be relinked when an event is renamed or newly scraped, and the
-- hot events table is untouched.
--
-- match_keys values:
--   meetup:<urlname>                          Meetup events, by URL path segment
--   series:<normalized title>|<organizer>     every other source
--
-- Additive only.

CREATE TABLE IF NOT EXISTS "groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"directory_key" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text NOT NULL,
	"website" text,
	"meetup_url" text,
	"schedule" text,
	"home_base" text,
	"match_keys" text[] DEFAULT '{}' NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "groups_directory_key_unique" UNIQUE("directory_key"),
	CONSTRAINT "groups_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "groups_category_idx" ON "groups" USING btree ("category");
--> statement-breakpoint

-- The app reads through Drizzle's postgres role, which bypasses RLS. Nothing
-- needs PostgREST access, so lock anon/authenticated out entirely.
ALTER TABLE "groups" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE "groups" FROM anon, authenticated;
