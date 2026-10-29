-- Summer camps refresh (lib/camps/refresh.ts, /api/cron/camps-refresh; docs/camps/01-context-and-plan.md
-- §6.5 as simplified by docs/camps/04-v2-plan.md §3).
--
--   extraction_fingerprint  the extraction's fingerprint (EXTRACTION_FINGERPRINT, or 'webtrac:<readAt>'
--                           for the catalog path), written by the import: a provider whose
--                           fingerprint differs from the deployed prompt is re-extracted on its next
--                           refresh. Null until the import runs once after this migration; the
--                           refresh skips those providers.
--   checked_at              last time the refresh read the provider's pages and compared them.
--                           A failed read does not advance it.
--   check_error             why the last check failed; null once one succeeds. Failing providers
--                           are retried after the ones due on schedule.
--
-- NOT YET APPLIED to the live database: run it by hand (DATABASE_URL is prod), then re-run
-- `npx tsx scripts/camps/import.ts --apply` to fill extraction_fingerprint from the files.
-- lib/db/schema.ts already has these columns, so the import fails (and writes nothing) until this runs.
--
-- Additive only, and idempotent. camp_providers already has RLS on and no anon/authenticated grants.

BEGIN;

ALTER TABLE "camp_providers" ADD COLUMN IF NOT EXISTS "extraction_fingerprint" text;
ALTER TABLE "camp_providers" ADD COLUMN IF NOT EXISTS "checked_at" timestamp with time zone;
ALTER TABLE "camp_providers" ADD COLUMN IF NOT EXISTS "check_error" text;

COMMIT;
