-- Summer camps: retire cards a newer extraction drops (docs/camps/05-v2-report.md, UX review).
--
--   last_extracted_at  the provider extraction (camp_providers.extracted_at) this camp was last in,
--                      written by the import (lib/camps/importCamps.ts) for every camp in that
--                      extraction, changed or not. A camp is live only while it equals its
--                      provider's extracted_at: a program missing from the provider's newest
--                      extraction is retired (not shown, not in the review queue, no feed event),
--                      never deleted, and comes back if a later extraction finds it again.
--                      `hidden` is untouched.
--
-- Backfill: every existing camp counts as in its provider's current extraction, as the pages
-- treated it until now; the next import of each provider retires what it drops.
--
-- NOT YET APPLIED to the live database: run it by hand (DATABASE_URL is prod). lib/db/schema.ts
-- already has the column, so the import fails (and writes nothing) until this runs.
--
-- Additive and idempotent. camps already has RLS on and no anon/authenticated grants.

BEGIN;

ALTER TABLE "camps" ADD COLUMN IF NOT EXISTS "last_extracted_at" timestamp with time zone;

UPDATE "camps" AS c
SET "last_extracted_at" = p."extracted_at"
FROM "camp_providers" AS p
WHERE p."key" = c."provider_key"
  AND c."last_extracted_at" IS NULL;

COMMIT;
