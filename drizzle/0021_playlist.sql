-- Weekly Spotify playlist (/playlist): the state the weekly job used to keep in
-- files on one Mac (~/.config/avlgo-playlist).
--
-- event_tracks   - one row per music event the job has looked at: the headliner
--                  the AI read from the title (or why it skipped the show), then
--                  the Spotify track. Rows are never re-asked; a recurring show
--                  reuses an earlier row with the same title.
-- playlist_picks - each week's playlist in order, so the page shows exactly
--                  what's on Spotify.
--
-- Additive only, and idempotent.

CREATE TABLE IF NOT EXISTS "event_tracks" (
	"event_id" uuid PRIMARY KEY NOT NULL REFERENCES "events"("id") ON DELETE cascade,
	"artist" text,
	"skip_reason" text,
	"spotify_track_id" text,
	"track_name" text,
	"spotify_artist" text,
	"note" text,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "playlist_picks" (
	"week_start" date NOT NULL,
	"position" integer NOT NULL,
	"event_id" uuid NOT NULL REFERENCES "events"("id") ON DELETE cascade,
	"spotify_track_id" text NOT NULL,
	"sold_out" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "playlist_picks_week_start_position_pk" PRIMARY KEY("week_start","position")
);
--> statement-breakpoint

-- The app reads through Drizzle's postgres role, which bypasses RLS. Nothing
-- needs PostgREST access, so lock anon/authenticated out entirely.
ALTER TABLE "event_tracks" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "playlist_picks" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE "event_tracks", "playlist_picks" FROM anon, authenticated;
