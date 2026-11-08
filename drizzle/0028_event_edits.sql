-- Admin edits on event pages: what an admin changed, so the scrape doesn't put it back.
--
--   edited_fields  each edited field (title, location, price, imageUrl) mapped to the value the
--                  row had before the first edit, which "Undo edits" restores. The scrape keeps an
--                  edited field as the admin left it, until the source's own title changes (a
--                  different event on that URL), which clears every edit.
--
-- NOT YET APPLIED to the live database: run it by hand BEFORE deploying. lib/db/schema.ts has the
-- column, so every events query fails until it exists.

ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "edited_fields" jsonb NOT NULL DEFAULT '{}'::jsonb;
