UPDATE "matching_questions"
SET
  "version" = '2026-03-15-v2',
  "updated_at" = now()
WHERE "program" = 'vibe'
  AND "active" = true
  AND "version" = '2026-03-15';
--> statement-breakpoint
UPDATE "matching_questions"
SET
  "config_json" = '{"phase":"phase1","maxSelections":5,"gridColumns":3,"options":[{"value":"ai","label":"AI / technology"},{"value":"philosophy","label":"Philosophy"},{"value":"startups","label":"Startups"},{"value":"psychology","label":"Psychology"},{"value":"art_design","label":"Art / design"},{"value":"travel","label":"Travel"},{"value":"health_fitness","label":"Health / fitness"},{"value":"music","label":"Music"},{"value":"food","label":"Food / cooking"},{"value":"science","label":"Science"},{"value":"history","label":"History"},{"value":"spirituality","label":"Spirituality"},{"value":"politics","label":"Politics"},{"value":"climate","label":"Climate"},{"value":"parenting","label":"Parenting"},{"value":"sports","label":"Sports"},{"value":"film_tv","label":"Film / TV"},{"value":"fashion","label":"Fashion"},{"value":"finance","label":"Finance"},{"value":"relationships","label":"Relationships"},{"value":"books_writing","label":"Books / writing"},{"value":"design_systems","label":"Design / systems"},{"value":"future_of_work","label":"Future of work"},{"value":"community","label":"Community building"},{"value":"cities","label":"Cities / urbanism"},{"value":"marketing","label":"Marketing / storytelling"},{"value":"education","label":"Education / learning"},{"value":"nature","label":"Nature / outdoors"}]}'::jsonb,
  "updated_at" = now()
WHERE "id" = 'vibe_topics'
  AND "program" = 'vibe';
--> statement-breakpoint
UPDATE "matching_questions"
SET
  "active" = false,
  "updated_at" = now()
WHERE "id" = 'vibe_help_with'
  AND "program" = 'vibe';
--> statement-breakpoint
UPDATE "matching_questions"
SET
  "order" = CASE "id"
    WHEN 'vibe_values' THEN 13
    WHEN 'vibe_conversation_vibes' THEN 14
    WHEN 'vibe_stranger_depth' THEN 15
    WHEN 'vibe_zero_prep_talk' THEN 16
    WHEN 'vibe_motto' THEN 17
    WHEN 'vibe_overhyped' THEN 18
    WHEN 'vibe_current_challenge' THEN 19
    WHEN 'vibe_learning_30_days' THEN 20
    WHEN 'vibe_love_being_asked' THEN 21
    WHEN 'vibe_rabbit_hole' THEN 22
    WHEN 'vibe_surprise' THEN 23
    ELSE "order"
  END,
  "updated_at" = now()
WHERE "program" = 'vibe'
  AND "version" = '2026-03-15-v2'
  AND "id" IN (
    'vibe_values',
    'vibe_conversation_vibes',
    'vibe_stranger_depth',
    'vibe_zero_prep_talk',
    'vibe_motto',
    'vibe_overhyped',
    'vibe_current_challenge',
    'vibe_learning_30_days',
    'vibe_love_being_asked',
    'vibe_rabbit_hole',
    'vibe_surprise'
  );
