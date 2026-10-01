-- Local news (/news): see docs/news/05-v1-plan.md §5.
--
-- news_sources  - one row per outlet domain; `enabled` is the takedown switch.
--                 Seeded from NEWS_SOURCES on every ingest run (which never
--                 flips `enabled` back on); aggregator publishers get a row on
--                 first sight.
-- news_articles - one row per publisher URL (`url` is the only ingest key).
--                 The outlet's own title/dek/body plus our AI fields. Full text
--                 is kept forever.
-- news_stories  - clusters of articles; only `state = 'live'` is ever shown
--                 (every feed read goes through lib/news/db.ts).
-- news_days     - the per-day "short version" summary of that day's Top stories.
--
-- Additive only, and idempotent. Applied by scripts/news/migrate.ts. One
-- transaction, so the tables never exist without RLS and the revoked grants.
--
-- RLS is enabled with no policies (deny-all) and anon/authenticated lose the
-- grants Supabase's default privileges hand every new public table - the same
-- posture as poster_uploads. All access is server-side through Drizzle's
-- postgres role, which bypasses RLS.

BEGIN;

CREATE TABLE IF NOT EXISTS "news_sources" (
  "domain" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "kind" text NOT NULL,
  "homepage" text,
  "enabled" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "news_sources_kind_check" CHECK ("kind" IN ('outlet', 'government', 'institution', 'community'))
);

CREATE TABLE IF NOT EXISTS "news_stories" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "short_id" text NOT NULL,
  "tier" text NOT NULL,
  "state" text DEFAULT 'pending' NOT NULL,
  "headline" text NOT NULL,
  "summary" text NOT NULL,
  "image_url" text,
  "topics" text[] DEFAULT '{}' NOT NULL,
  "place" text,
  "importance" integer DEFAULT 0 NOT NULL,
  "score" integer DEFAULT 0 NOT NULL,
  "top_rank" integer,
  "filing_day" date NOT NULL,
  "lead_article_id" uuid,
  "article_count" integer DEFAULT 0 NOT NULL,
  "outlet_count" integer DEFAULT 0 NOT NULL,
  "first_published_at" timestamp with time zone NOT NULL,
  "last_article_at" timestamp with time zone NOT NULL,
  "dirty" boolean DEFAULT true NOT NULL,
  "search_tsv" tsvector GENERATED ALWAYS AS (
    to_tsvector('english', coalesce("headline", '') || ' ' || coalesce("summary", ''))
  ) STORED,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "news_stories_short_id_unique" UNIQUE ("short_id"),
  CONSTRAINT "news_stories_tier_check" CHECK ("tier" IN ('newsroom', 'community')),
  CONSTRAINT "news_stories_state_check" CHECK ("state" IN ('pending', 'live', 'hidden'))
);

CREATE TABLE IF NOT EXISTS "news_articles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "url" text NOT NULL,
  "source" text NOT NULL,
  "source_id" text NOT NULL,
  "outlet_domain" text NOT NULL,
  "outlet_name" text NOT NULL,
  "kind" text NOT NULL,
  "title" text NOT NULL,
  "dek" text,
  "content_text" text,
  "author" text,
  "image_url" text,
  "linked_url" text,
  "categories" text[] DEFAULT '{}' NOT NULL,
  "engagement" jsonb,
  "paywalled" boolean DEFAULT false NOT NULL,
  "published_at" timestamp with time zone NOT NULL,
  "first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "fulltext_status" text NOT NULL,
  "fulltext_attempts" integer DEFAULT 0 NOT NULL,
  "input_hash" text NOT NULL,
  "enriched_hash" text,
  "state" text DEFAULT 'pending' NOT NULL,
  "skip_reason" text,
  "ai_headline" text,
  "ai_summary" text,
  "what_happened" text,
  "entities" text[] DEFAULT '{}' NOT NULL,
  "topics" text[] DEFAULT '{}' NOT NULL,
  "place" text,
  "buncombe" text,
  "importance" integer,
  "community_important" boolean,
  "ai_attempts" integer DEFAULT 0 NOT NULL,
  "ai_error" text,
  "enriched_at" timestamp with time zone,
  "embedding" vector(1536),
  "story_id" uuid,
  "cluster_reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "news_articles_url_unique" UNIQUE ("url"),
  CONSTRAINT "news_articles_story_id_news_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "news_stories"("id") ON DELETE set null,
  CONSTRAINT "news_articles_kind_check" CHECK ("kind" IN ('outlet', 'government', 'institution', 'community')),
  CONSTRAINT "news_articles_state_check" CHECK ("state" IN ('pending', 'live', 'skipped', 'hidden')),
  CONSTRAINT "news_articles_fulltext_status_check" CHECK ("fulltext_status" IN ('none_needed', 'pending', 'fetched', 'unavailable', 'failed'))
);

CREATE TABLE IF NOT EXISTS "news_days" (
  "day" date PRIMARY KEY NOT NULL,
  "summary" jsonb NOT NULL,
  "input_hash" text NOT NULL,
  "generated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "news_articles_published_at_idx" ON "news_articles" USING btree ("published_at");
CREATE INDEX IF NOT EXISTS "news_articles_story_id_idx" ON "news_articles" USING btree ("story_id");
CREATE INDEX IF NOT EXISTS "news_articles_state_idx" ON "news_articles" USING btree ("state");
CREATE INDEX IF NOT EXISTS "news_articles_outlet_domain_idx" ON "news_articles" USING btree ("outlet_domain");
CREATE INDEX IF NOT EXISTS "news_articles_source_source_id_idx" ON "news_articles" USING btree ("source", "source_id");

CREATE INDEX IF NOT EXISTS "news_stories_filing_day_idx" ON "news_stories" USING btree ("filing_day");
CREATE INDEX IF NOT EXISTS "news_stories_state_idx" ON "news_stories" USING btree ("state");
CREATE INDEX IF NOT EXISTS "news_stories_dirty_idx" ON "news_stories" USING btree ("dirty") WHERE "dirty";
CREATE INDEX IF NOT EXISTS "news_stories_search_tsv_idx" ON "news_stories" USING gin ("search_tsv");

ALTER TABLE "news_sources" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "news_articles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "news_stories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "news_days" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "news_sources" FROM anon, authenticated;
REVOKE ALL ON TABLE "news_articles" FROM anon, authenticated;
REVOKE ALL ON TABLE "news_stories" FROM anon, authenticated;
REVOKE ALL ON TABLE "news_days" FROM anon, authenticated;

COMMIT;
