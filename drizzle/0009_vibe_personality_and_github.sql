UPDATE "matching_questions"
SET
  "version" = '2026-03-17',
  "updated_at" = now()
WHERE "program" = 'vibe'
  AND "active" = true
  AND "version" = '2026-03-15-v2';
--> statement-breakpoint
UPDATE "matching_questions"
SET
  "order" = CASE "id"
    WHEN 'vibe_linkedin_url' THEN 1
    WHEN 'vibe_links_about_you' THEN 3
    WHEN 'vibe_links_about_topics' THEN 4
    WHEN 'vibe_resume' THEN 5
    ELSE "order"
  END,
  "updated_at" = now()
WHERE "program" = 'vibe'
  AND "active" = true
  AND "id" IN (
    'vibe_linkedin_url',
    'vibe_links_about_you',
    'vibe_links_about_topics',
    'vibe_resume'
  );
--> statement-breakpoint
INSERT INTO "matching_questions" (
  "id",
  "program",
  "version",
  "section",
  "order",
  "prompt",
  "help_text",
  "required",
  "input_type",
  "max_length",
  "config_json",
  "websearch",
  "active"
)
VALUES
  (
    'vibe_github_url',
    'vibe',
    '2026-03-17',
    'passive',
    2,
    'GitHub profile (optional)',
    'Share your GitHub if it is a good window into how you build, think, or what you care about.',
    false,
    'url',
    null,
    '{"placeholder":"https://github.com/..."}'::jsonb,
    true,
    true
  ),
  (
    'q_vibe_personality_results',
    'vibe',
    '2026-03-17',
    'survey',
    24,
    'Do you know your Myers-Briggs, Enneagram, or OCEAN results? If so, share them.',
    'Anything from INTJ to 7w6 to high openness / low neuroticism is useful. Share as much or as little as you want.',
    false,
    'short_text',
    300,
    '{"phase":"phase2","placeholder":"e.g. ENFP, 7w8, high openness / low neuroticism"}'::jsonb,
    false,
    true
  )
ON CONFLICT ("id") DO UPDATE
SET
  "program" = EXCLUDED."program",
  "version" = EXCLUDED."version",
  "section" = EXCLUDED."section",
  "order" = EXCLUDED."order",
  "prompt" = EXCLUDED."prompt",
  "help_text" = EXCLUDED."help_text",
  "required" = EXCLUDED."required",
  "input_type" = EXCLUDED."input_type",
  "max_length" = EXCLUDED."max_length",
  "config_json" = EXCLUDED."config_json",
  "websearch" = EXCLUDED."websearch",
  "active" = EXCLUDED."active",
  "updated_at" = now();
