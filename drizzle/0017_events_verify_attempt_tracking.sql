-- Back off events whose verification didn't land, so they stop holding the head
-- of the verify queue.
--
-- The verify cron takes the 30 soonest unverified events and leaves a row
-- unstamped when its Jina fetch fails, the AI call errors, or the AI's answer is
-- below the confidence bar. Nothing recorded the failure, so the same rows came
-- back on every run until their start date passed.
--
-- verify_attempts        - attempts that didn't land (success stamps
--                          last_verified_at, which retires the row instead)
-- verify_next_attempt_at - do not retry before this; NULL means eligible now
--
-- Additive only: existing rows default to 0 attempts and a NULL next-attempt
-- time, so they stay immediately eligible exactly as before.
--
-- Run this BEFORE deploying the code that references these columns: every
-- `db.select().from(events)` names each schema column, so event pages would
-- fail too, not just the verify cron.

ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "verify_attempts" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint

ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "verify_next_attempt_at" timestamp with time zone;
