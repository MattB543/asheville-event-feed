-- Summer camps refresh: compare fact lines instead of one hash, and don't retire a program on a
-- single miss (lib/camps/sourceLines.ts, lib/camps/refresh.ts, lib/camps/importCamps.ts).
--
--   camp_providers.source_lines  the fact-line hashes of the pages its newest extraction read.
--                                A refresh re-extracts when lines were added or removed. NULL until
--                                the provider's first check with this code, which re-extracts it.
--   camps.missed_at              set when a live camp is missing from its provider's new extraction
--                                for the first time: it stays live for that extraction (a model
--                                typo retired a real camp, 2026-11-14) and is retired when the next
--                                one lacks it too. Cleared whenever an extraction has the camp.
--
-- Run it by hand BEFORE deploying the code (DATABASE_URL is prod): lib/db/schema.ts has both
-- columns, and every read of camps or camp_providers selects them. Older code ignores them.
--
-- Additive and idempotent. Both tables already have RLS on and no anon/authenticated grants.

ALTER TABLE "camp_providers" ADD COLUMN IF NOT EXISTS "source_lines" text[];
--> statement-breakpoint
ALTER TABLE "camps" ADD COLUMN IF NOT EXISTS "missed_at" timestamp with time zone;
