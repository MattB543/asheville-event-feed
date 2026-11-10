-- A season's dates, banner (text, colour and icon) and on/off switch as an admin set them at /admin/seasons. A season with no row
-- uses the defaults in lib/seasons.ts, so the site reads the same until someone edits one.
--
-- Additive only, and idempotent. The site falls back to the defaults while it's missing.

CREATE TABLE IF NOT EXISTS "season_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"start_day" text NOT NULL,
	"end_day" text NOT NULL,
	"short" text NOT NULL,
	"banner" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"color" text NOT NULL,
	"fade" boolean DEFAULT false NOT NULL,
	"icon" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- Read and written only through Drizzle's postgres role, which bypasses RLS
ALTER TABLE "season_settings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE "season_settings" FROM anon, authenticated;
