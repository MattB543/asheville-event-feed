-- Persist the adult verdict as a queryable flag on the upload.
--
-- The reason columns say WHY an upload was held; this says whether the image
-- itself is unsuitable for the signed-out /posters feed. It stays true after a
-- moderator approves the upload - approval means "this may be published", not
-- "this is family-safe" - which is what lets the public feed keep hiding the
-- image while its events behave like any other event on the site.
ALTER TABLE "poster_uploads" ADD COLUMN IF NOT EXISTS "adult" boolean DEFAULT false NOT NULL;

-- Anything that ever tripped either axis is adult for feed purposes.
UPDATE "poster_uploads"
SET "adult" = true
WHERE "adult" = false
  AND ("adult_reason" IS NOT NULL OR "safety_reason" IS NOT NULL);

-- The feed's hot query is (status, adult); the partial index keeps it to the
-- published rows it actually scans.
CREATE INDEX IF NOT EXISTS "poster_uploads_public_feed_idx"
  ON "poster_uploads" ("created_at" DESC)
  WHERE "status" = 'published' AND "adult" = false;
