-- Track AI tag/summary generation attempts so repeat failures back off instead
-- of being re-selected (with a full paid call) on every run.
--
-- ai_attempts        - consecutive failed attempts; reset to 0 on success
-- ai_last_attempt_at - when the last attempt ran (observability)
-- ai_next_attempt_at - do not retry before this; NULL means eligible now
--
-- Additive only: existing rows default to 0 attempts and a NULL next-attempt
-- time, so they stay immediately eligible exactly as before.

ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "ai_attempts" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint

ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "ai_last_attempt_at" timestamp with time zone;
--> statement-breakpoint

ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "ai_next_attempt_at" timestamp with time zone;
