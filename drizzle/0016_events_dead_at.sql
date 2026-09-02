-- Soft-delete for events whose source URL is gone.
--
-- The cleanup job used to hard-delete these, which left no way to tell a
-- genuine removal from a bad check and no way to undo one. Mirror the
-- deduped_at convention instead: NULL = live, a timestamp = removed, and a
-- restore is just setting it back to NULL.
ALTER TABLE events ADD COLUMN IF NOT EXISTS dead_at timestamptz;

-- Every feed query filters deduped_at IS NULL AND dead_at IS NULL.
CREATE INDEX IF NOT EXISTS events_dead_at_idx ON events (dead_at) WHERE dead_at IS NULL;
