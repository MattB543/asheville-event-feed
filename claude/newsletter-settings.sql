-- Newsletter settings table (independent from live feed filters)
CREATE TABLE IF NOT EXISTS newsletter_settings (
  user_id uuid PRIMARY KEY,
  frequency text NOT NULL DEFAULT 'none',
  day_selection text NOT NULL DEFAULT 'everyday',
  selected_days integer[] NOT NULL DEFAULT '{}'::integer[],
  weekend_edition boolean NOT NULL DEFAULT false,
  score_tier text NOT NULL DEFAULT 'all',
  filters jsonb,
  curator_user_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  last_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE newsletter_settings
  ADD COLUMN IF NOT EXISTS day_selection text NOT NULL DEFAULT 'everyday';

ALTER TABLE newsletter_settings
  ADD COLUMN IF NOT EXISTS selected_days integer[] NOT NULL DEFAULT '{}'::integer[];
