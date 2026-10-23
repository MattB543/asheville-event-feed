-- Hand edits to a holiday page (/halloween): add an event to the weekend wall, hide one
-- that doesn't fit, or give it a poster when its own image is blocked or gone.
-- One row per season and event; the page applies them over its automatic picks.
--
-- Additive only, and idempotent.

CREATE TABLE IF NOT EXISTS "season_picks" (
	"season" text NOT NULL,
	"event_id" uuid NOT NULL REFERENCES "events"("id") ON DELETE CASCADE,
	"added" boolean DEFAULT false NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"poster_url" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	PRIMARY KEY ("season", "event_id")
);
--> statement-breakpoint

-- Read and written only through Drizzle's postgres role, which bypasses RLS
ALTER TABLE "season_picks" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE "season_picks" FROM anon, authenticated;
--> statement-breakpoint

-- The posters first saved into the site's files, carried over so nothing changes on the page
INSERT INTO "season_picks" ("season", "event_id", "poster_url")
SELECT 'halloween', e."id", '/halloween/' || e."id" || '.jpg'
FROM "events" e
WHERE e."id" IN (
	'0c3f213b-f593-4082-a47f-d983b14bf1e0',
	'2847b5b6-e992-4d5a-8a33-b9980113c579',
	'3d3f5832-5753-4bcd-b570-32466b7d510d',
	'518a629a-d693-474e-a8fc-50f558c7abb8',
	'b634f90b-7101-4f44-aaec-996da7d65a91',
	'c5a5a9f8-146e-400f-a00c-22300421b9ab'
)
ON CONFLICT DO NOTHING;
