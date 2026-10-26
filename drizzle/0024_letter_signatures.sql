-- Signatures on the open letter at /plan. One row per letter and signed-in user
-- (Supabase auth.users id, no FK, repo convention); the email stays in auth.users.
-- Private signatures are approved at once; public ones wait for the super admin.
--
-- Additive only, and idempotent.

CREATE TABLE IF NOT EXISTS "letter_signatures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"letter" text NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"neighborhood" text,
	"role" text,
	"is_public" boolean NOT NULL,
	"wants_updates" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	-- Goes up on every edit and review, so a review applies only to the version the admin saw
	"revision" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "letter_signatures_letter_user_idx" ON "letter_signatures" ("letter", "user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "letter_signatures_letter_status_idx" ON "letter_signatures" ("letter", "status");
--> statement-breakpoint

-- Read and written only through Drizzle's postgres role, which bypasses RLS
ALTER TABLE "letter_signatures" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE "letter_signatures" FROM anon, authenticated;
