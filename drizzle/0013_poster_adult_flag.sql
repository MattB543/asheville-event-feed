-- Second moderation axis for poster uploads.
--
-- `safety_reason` answers "is this unsafe for a 13-year-old" (nudity, gore, hate
-- symbols). `adult_reason` answers a separate question: "is this an adult-audience
-- event" (21+/30+ door policy, nightlife promotion built on sexualized imagery,
-- burlesque, cannabis). Either one now holds an upload at `pending_review`, but
-- keeping them apart means the moderation queue can say WHY it was held - and a
-- 'grown & sexy' club flyer is no longer forced to be called a safety problem to
-- keep it off the feed.
ALTER TABLE "poster_uploads" ADD COLUMN IF NOT EXISTS "adult_reason" text;
