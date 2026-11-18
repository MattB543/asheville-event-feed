-- The order of the Top 30 "Meet people" (social) and "Asheville weird" lists, as the
-- daily head-to-head pass ranked them (lib/top30/headToHead.ts). Each event's own 1-10
-- score left most of a list tied; here the AI compares the candidates with each other.
-- One row per ranked event; the lists read ranked events first, then the rest by score.
-- `title` is the title that was ranked: a row whose event has since been renamed (a
-- different event on that URL) no longer counts.
--
-- Additive only, and idempotent.

CREATE TABLE IF NOT EXISTS "top30_ranks" (
	"category" text NOT NULL,
	"event_id" uuid NOT NULL REFERENCES "events"("id") ON DELETE CASCADE,
	"rank" integer NOT NULL,
	"title" text NOT NULL,
	"ranked_at" timestamp with time zone DEFAULT now() NOT NULL,
	PRIMARY KEY ("category", "event_id")
);
--> statement-breakpoint

-- Read and written only through Drizzle's postgres role, which bypasses RLS
ALTER TABLE "top30_ranks" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE "top30_ranks" FROM anon, authenticated;
