-- One line explaining an unusual genre tag ("Zydeco": accordion-led dance music
-- from Louisiana), shown as a tooltip on /playlist. A null note means the genre
-- is common enough to need none; either way it's never asked about again.
--
-- Additive only, and idempotent.

CREATE TABLE IF NOT EXISTS "genre_notes" (
	"genre" text PRIMARY KEY NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- Read and written only through Drizzle's postgres role, which bypasses RLS
ALTER TABLE "genre_notes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE "genre_notes" FROM anon, authenticated;
