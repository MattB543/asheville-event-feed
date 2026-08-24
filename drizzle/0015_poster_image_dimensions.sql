-- Store the normalized JPEG's pixel dimensions on the upload row.
--
-- The /posters wall is a masonry layout, so the browser needs each poster's
-- aspect ratio at first paint or every tile reflows once its image decodes.
-- The dimensions are known at upload time (sharp already re-encodes the file),
-- so recording them costs nothing and removes the layout shift entirely.
ALTER TABLE "poster_uploads" ADD COLUMN IF NOT EXISTS "image_width" integer;
ALTER TABLE "poster_uploads" ADD COLUMN IF NOT EXISTS "image_height" integer;
