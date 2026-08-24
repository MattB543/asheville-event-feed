-- Poster uploads: user-submitted photos of event posters, AI-extracted into events.
--
-- poster_uploads     - one row per uploaded image; single `status` state machine
--                      ('processing' | 'failed' | 'pending_review' | 'published' | 'denied').
--                      image_path points at the PRIVATE ingress bucket; public_image_url is
--                      only set once the image is copied to the public bucket on publish.
-- poster_extractions - one row per poster detected in an image (multi-date flyers get one
--                      row per printed date, sharing an `ordinal`).
--
-- RLS is enabled with no policies (deny-all). All access flows through Drizzle's `postgres`
-- role, which bypasses RLS; nothing reaches these tables via PostgREST.

CREATE TABLE IF NOT EXISTS "poster_uploads" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "image_path" text NOT NULL,
  "public_image_url" text,
  "image_hash" text NOT NULL,
  "file_size_bytes" integer,
  "status" text DEFAULT 'processing' NOT NULL,
  "safety_reason" text,
  "error_message" text,
  "raw_model_output" text,
  "reviewed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "poster_extractions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "upload_id" uuid NOT NULL,
  "ordinal" integer DEFAULT 0 NOT NULL,
  "title" text NOT NULL,
  "raw_text" text,
  "start_date" timestamp with time zone,
  "time_unknown" boolean DEFAULT false NOT NULL,
  "location" text,
  "organizer" text,
  "description" text,
  "price" text,
  "outcome" text,
  "event_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "poster_extractions_upload_id_poster_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "poster_uploads"("id") ON DELETE cascade,
  CONSTRAINT "poster_extractions_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE set null
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "poster_uploads_created_at_idx" ON "poster_uploads" USING btree ("created_at");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "poster_uploads_user_id_idx" ON "poster_uploads" USING btree ("user_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "poster_uploads_status_idx" ON "poster_uploads" USING btree ("status");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "poster_uploads_image_hash_idx" ON "poster_uploads" USING btree ("image_hash");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "poster_extractions_upload_id_idx" ON "poster_extractions" USING btree ("upload_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "poster_extractions_event_id_idx" ON "poster_extractions" USING btree ("event_id");
--> statement-breakpoint

ALTER TABLE "poster_uploads" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

ALTER TABLE "poster_extractions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Supabase's default privileges hand anon/authenticated full grants on every new public
-- table. Neither role should reach these tables at all (same posture as cron_job_runs),
-- so drop the grants too rather than relying on deny-all RLS alone.
REVOKE ALL ON TABLE "poster_uploads" FROM anon, authenticated;
--> statement-breakpoint

REVOKE ALL ON TABLE "poster_extractions" FROM anon, authenticated;
