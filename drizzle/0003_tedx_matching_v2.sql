ALTER TABLE "matching_profiles"
ADD COLUMN IF NOT EXISTS "source" text;
--> statement-breakpoint
ALTER TABLE "matching_profiles"
ADD COLUMN IF NOT EXISTS "allow_editing" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
UPDATE "matching_questions"
SET
  "active" = false,
  "updated_at" = now()
WHERE "program" = 'tedx';
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
  "websearch",
  "active"
)
VALUES
  (
    'resume',
    'tedx',
    '2026-02-07',
    'passive',
    1,
    'Resume (optional)',
    'Upload a PDF resume or paste text. We will extract the key details automatically.',
    false,
    'file_markdown',
    20000,
    false,
    true
  ),
  (
    'links_about_you',
    'tedx',
    '2026-02-07',
    'passive',
    2,
    'Links about you (optional)',
    'Share up to 5 links that help us understand who you are: LinkedIn, portfolio, talks, projects, interviews.',
    false,
    'multi_url',
    null,
    true,
    true
  ),
  (
    'links_about_topics',
    'tedx',
    '2026-02-07',
    'passive',
    3,
    'Links & media you love (optional)',
    'Share up to 10 things you are into: articles, podcasts, books, movies, people, organizations, or topics.',
    false,
    'multi_text',
    300,
    true,
    true
  ),
  (
    'q1',
    'tedx',
    '2026-02-07',
    'survey',
    1,
    'What makes you weird?',
    'The quirks, unusual interests, or unexpected things about you that most people do not know.',
    false,
    'long_text',
    1400,
    false,
    true
  ),
  (
    'q2',
    'tedx',
    '2026-02-07',
    'survey',
    2,
    'What mess did you most recently embrace?',
    'A failure, chaotic situation, or imperfect thing you leaned into instead of running from.',
    false,
    'long_text',
    1400,
    false,
    true
  ),
  (
    'q3',
    'tedx',
    '2026-02-07',
    'survey',
    3,
    'What mess are you NOT embracing?',
    'Something messy in your life or work that you are avoiding, resisting, or pretending is not there.',
    false,
    'long_text',
    1400,
    false,
    true
  ),
  (
    'q4',
    'tedx',
    '2026-02-07',
    'survey',
    4,
    'What do you believe that most people here would disagree with?',
    'A contrarian take, unpopular opinion, or unconventional view you hold.',
    false,
    'long_text',
    1400,
    false,
    true
  ),
  (
    'q5',
    'tedx',
    '2026-02-07',
    'survey',
    5,
    'What can you not stop thinking about?',
    'An idea, question, project, or rabbit hole that keeps pulling you back.',
    false,
    'long_text',
    1400,
    false,
    true
  ),
  (
    'q6',
    'tedx',
    '2026-02-07',
    'survey',
    6,
    'What do you know deeply and love sharing?',
    'Expertise, skills, or hard-won knowledge you could teach others or talk about for hours.',
    false,
    'long_text',
    1400,
    false,
    true
  ),
  (
    'q7',
    'tedx',
    '2026-02-07',
    'survey',
    7,
    'Who are your people?',
    'Your tribe, community, or the types of people you feel most at home with.',
    false,
    'long_text',
    1400,
    false,
    true
  ),
  (
    'q8',
    'tedx',
    '2026-02-07',
    'survey',
    8,
    'How would your closest friends describe you?',
    'Personality traits, archetypes, and overall vibe.',
    false,
    'long_text',
    1400,
    false,
    true
  ),
  (
    'q9',
    'tedx',
    '2026-02-07',
    'survey',
    9,
    'Your life in a bumper sticker',
    'A phrase, motto, or one-liner that captures your approach to life.',
    false,
    'long_text',
    1400,
    false,
    true
  ),
  (
    'q10',
    'tedx',
    '2026-02-07',
    'survey',
    10,
    'What else should we know about you?',
    'Anything we did not ask that you want to share.',
    false,
    'long_text',
    1400,
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
  "websearch" = EXCLUDED."websearch",
  "active" = EXCLUDED."active",
  "updated_at" = now();
