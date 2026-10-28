-- Summer camps (/camps): the revised data model in docs/camps/01-context-and-plan.md §5.
--
--   camps                         a stable offering (provider + program + variant), year-independent
--   camp_seasons                  one summer's facts for a camp, every fact with source URL + quote
--   camp_registration_milestones  registration dates per summer, audience and kind; season_year is
--                                 the summer, date can fall in the year before it
--   camp_availability             the latest availability seen per camp and summer
--   camp_observations             append-only fetch / availability log (refresh, sell-out intervals)
--   camp_views                    popularity: one row per camp per Eastern day (D8, N6)
--
-- Imports never delete a camp they don't mention and never write `hidden`.
-- NOT YET APPLIED to the live database: run it by hand once Matt approves (DATABASE_URL is prod).
--
-- Additive only, and idempotent.

CREATE TABLE IF NOT EXISTS "camps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"camp_key" text NOT NULL,
	"slug" text NOT NULL,
	"provider_key" text NOT NULL,
	"provider_name" text NOT NULL,
	"name" text NOT NULL,
	"variant" text,
	"type" text NOT NULL,
	"categories" text[] DEFAULT '{}' NOT NULL,
	"aliases" text[] DEFAULT '{}' NOT NULL,
	"website_url" text,
	"camp_page_url" text,
	"registration_url" text,
	"platform" text,
	"platform_ids" jsonb,
	"description" text,
	"discovered_by" text[] DEFAULT '{}' NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "camps_camp_key_unique" UNIQUE("camp_key"),
	CONSTRAINT "camps_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "camps_provider_idx" ON "camps" USING btree ("provider_key");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "camp_seasons" (
	"camp_id" uuid NOT NULL REFERENCES "camps"("id") ON DELETE CASCADE,
	"season_year" integer NOT NULL,
	"season_start" date,
	"season_end" date,
	"age_min" integer,
	"age_max" integer,
	"grade_min" integer,
	"grade_max" integer,
	"grade_basis" text,
	"hours_start" text,
	"hours_end" text,
	"early_dropoff_start" text,
	"late_pickup_end" text,
	"price_min_cents" integer,
	"price_max_cents" integer,
	"price_unit" text,
	"town" text,
	"state" text,
	"drive_seconds" integer,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"facts" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "camp_seasons_pk" PRIMARY KEY ("camp_id", "season_year")
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "camp_registration_milestones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"camp_id" uuid NOT NULL REFERENCES "camps"("id") ON DELETE CASCADE,
	"season_year" integer NOT NULL,
	"audience" text NOT NULL,
	"kind" text NOT NULL,
	"date" date NOT NULL,
	-- 'HH:MM' Eastern, only when the source states a time
	"time" text,
	"precision" text NOT NULL,
	"source_url" text NOT NULL,
	"quote" text NOT NULL,
	"source_kind" text NOT NULL,
	"verify_status" text NOT NULL,
	"hand_checked_at" timestamp with time zone,
	"hand_checked_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "camp_milestones_unique_idx" ON "camp_registration_milestones" ("camp_id", "season_year", "audience", "kind");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "camp_availability" (
	"camp_id" uuid NOT NULL REFERENCES "camps"("id") ON DELETE CASCADE,
	"season_year" integer NOT NULL,
	"status" text NOT NULL,
	"scope" text,
	"source_url" text NOT NULL,
	"quote" text,
	"observed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "camp_availability_pk" PRIMARY KEY ("camp_id", "season_year")
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "camp_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"camp_id" uuid REFERENCES "camps"("id") ON DELETE SET NULL,
	"url" text NOT NULL,
	"kind" text NOT NULL,
	"ok" boolean NOT NULL,
	"fetch_method" text,
	"text_hash" text,
	"error" text,
	"details" jsonb,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "camp_observations_camp_idx" ON "camp_observations" ("camp_id", "observed_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "camp_observations_url_idx" ON "camp_observations" ("url", "observed_at");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "camp_views" (
	"camp_id" uuid NOT NULL REFERENCES "camps"("id") ON DELETE CASCADE,
	"day" date NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "camp_views_pk" PRIMARY KEY ("camp_id", "day")
);
--> statement-breakpoint

-- Read and written only through Drizzle's postgres role, which bypasses RLS. Nothing needs
-- PostgREST access, so lock anon/authenticated out entirely (like groups).
ALTER TABLE "camps" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "camp_seasons" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "camp_registration_milestones" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "camp_availability" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "camp_observations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "camp_views" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE "camps", "camp_seasons", "camp_registration_milestones", "camp_availability", "camp_observations", "camp_views" FROM anon, authenticated;
