-- Summer camps (/camps): docs/camps/04-v2-plan.md §4.
--
--   camp_providers  one row per provider from discovery (data/camps/providers.json)
--   camps           one card per program: `card` is the CampCard as extracted
--                   (lib/camps/contract.ts), `override` Matt's fixes (top-level CampCard keys
--                   that replace the extracted ones). The columns from name to season_end are
--                   copied from the effective card ({...card, ...override}) for filtering.
--                   reviewed_hash is the hash of the effective card Matt confirmed, so a
--                   re-extraction that changes it puts the camp back in the review queue.
--   camp_sites      drop-off sites per provider, unique by name; cards point at them by name.
--                   geocode_source 'hand' is a pin pasted in /admin/camps: the import never
--                   overwrites it.
--   camp_views      popularity: one row per camp per Eastern day
--   camp_calendars  subscribable calendar feeds of saved camps, by token
--
-- scripts/camps/import.ts writes these. It never deletes a camp and never writes `hidden`,
-- `override` or `reviewed_*`.
--
-- Replaces the pilot's version of this file, which was never applied.
-- NOT YET APPLIED to the live database: run it by hand once reviewed (DATABASE_URL is prod).
--
-- Additive only, and idempotent. One transaction, so the tables never exist without RLS and
-- the revoked grants.

BEGIN;

CREATE TABLE IF NOT EXISTS "camp_providers" (
	"key" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"website_url" text,
	"urls" text[] DEFAULT '{}' NOT NULL,
	"area" text,
	"discovered_by" text[] DEFAULT '{}' NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"notes" text,
	"extracted_at" timestamp with time zone,
	-- Hash of the fetched source text, so a refresh re-extracts only providers that changed
	"source_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "camps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"camp_key" text NOT NULL,
	"slug" text NOT NULL,
	"provider_key" text NOT NULL,
	"card" jsonb NOT NULL,
	"override" jsonb,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"categories" text[] DEFAULT '{}' NOT NULL,
	"confidence" text NOT NULL,
	"review_notes" text,
	"age_min" integer,
	"age_max" integer,
	"grade_min" integer,
	"grade_max" integer,
	"season_year" integer NOT NULL,
	"season_start" date,
	"season_end" date,
	"reviewed_at" timestamp with time zone,
	"reviewed_hash" text,
	"hidden" boolean DEFAULT false NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "camps_camp_key_unique" UNIQUE("camp_key"),
	CONSTRAINT "camps_slug_unique" UNIQUE("slug"),
	CONSTRAINT "camps_provider_key_camp_providers_key_fk" FOREIGN KEY ("provider_key") REFERENCES "camp_providers"("key")
);

CREATE INDEX IF NOT EXISTS "camps_provider_idx" ON "camps" USING btree ("provider_key");
CREATE INDEX IF NOT EXISTS "camps_hidden_idx" ON "camps" USING btree ("hidden");

CREATE TABLE IF NOT EXISTS "camp_sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_key" text NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"town" text,
	"state" text,
	"lat" double precision,
	"lng" double precision,
	-- 'census' | 'ors' | 'hand'
	"geocode_source" text,
	"geocode_label" text,
	-- From Pack Square (ORS, no traffic), unrounded
	"drive_minutes" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "camp_sites_provider_key_camp_providers_key_fk" FOREIGN KEY ("provider_key") REFERENCES "camp_providers"("key")
);

CREATE UNIQUE INDEX IF NOT EXISTS "camp_sites_provider_name_idx" ON "camp_sites" USING btree ("provider_key", "name");

CREATE TABLE IF NOT EXISTS "camp_views" (
	"camp_id" uuid NOT NULL,
	"day" date NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "camp_views_pk" PRIMARY KEY ("camp_id", "day"),
	CONSTRAINT "camp_views_camp_id_camps_id_fk" FOREIGN KEY ("camp_id") REFERENCES "camps"("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "camp_calendars" (
	"token" text PRIMARY KEY NOT NULL,
	"camp_ids" uuid[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_fetched_at" timestamp with time zone
);

-- Read and written only through Drizzle's postgres role, which bypasses RLS. Nothing needs
-- PostgREST access, so RLS with no policies (deny-all) and no anon/authenticated grants,
-- like groups.
ALTER TABLE "camp_providers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "camps" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "camp_sites" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "camp_views" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "camp_calendars" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "camp_providers", "camps", "camp_sites", "camp_views", "camp_calendars" FROM anon, authenticated;

COMMIT;
