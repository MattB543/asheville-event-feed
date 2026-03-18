-- Add bookshelf image question to vibe survey (phase 1)
-- New input type: multi_image
-- Images are NOT stored - they are passed to AI for transcription and only the
-- extracted book list is saved in answer_json

-- Bump version for all active vibe questions
UPDATE "matching_questions"
SET
  "version" = '2026-03-17-v2',
  "updated_at" = now()
WHERE "program" = 'vibe'
  AND "active" = true
  AND "version" = '2026-03-17';
--> statement-breakpoint

-- Insert the bookshelf question
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
) VALUES (
  'vibe_bookshelf',
  'vibe',
  '2026-03-17-v2',
  'survey',
  16,
  'Show us your bookshelf',
  'Upload up to 5 photos of your bookshelf, coffee table books, or book stack. Our AI will identify the titles — you can review and remove any before saving. Your images are never stored.',
  false,
  'multi_image',
  NULL,
  '{
    "phase": "phase1",
    "maxImages": 5,
    "aiPrompt": null
  }'::jsonb,
  false,
  true
);
--> statement-breakpoint

-- Shift phase 2 questions down to make room
UPDATE "matching_questions"
SET
  "order" = "order" + 1,
  "updated_at" = now()
WHERE "program" = 'vibe'
  AND "active" = true
  AND "config_json"->>'phase' = 'phase2'
  AND "id" != 'vibe_bookshelf';
