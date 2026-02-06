CREATE TABLE "matching_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"program" text DEFAULT 'tedx' NOT NULL,
	"display_name" text,
	"email" text,
	"ai_matching" boolean DEFAULT false NOT NULL,
	"consent_at" timestamp with time zone,
	"consent_version" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "matching_questions" (
	"id" text PRIMARY KEY NOT NULL,
	"program" text NOT NULL,
	"version" text NOT NULL,
	"section" text NOT NULL,
	"order" integer NOT NULL,
	"prompt" text NOT NULL,
	"help_text" text,
	"required" boolean DEFAULT false NOT NULL,
	"input_type" text NOT NULL,
	"max_length" integer,
	"websearch" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "matching_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"question_id" text NOT NULL,
	"answer_text" text,
	"answer_json" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "matching_answers_profile_id_matching_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "matching_profiles"("id") ON DELETE cascade,
	CONSTRAINT "matching_answers_question_id_matching_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "matching_questions"("id") ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "ai_matching" boolean DEFAULT false;
--> statement-breakpoint
CREATE UNIQUE INDEX "matching_profiles_user_id_unique" ON "matching_profiles" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "matching_profiles_program_idx" ON "matching_profiles" USING btree ("program");
--> statement-breakpoint
CREATE INDEX "matching_questions_program_idx" ON "matching_questions" USING btree ("program");
--> statement-breakpoint
CREATE INDEX "matching_questions_program_version_idx" ON "matching_questions" USING btree ("program","version");
--> statement-breakpoint
CREATE UNIQUE INDEX "matching_answers_profile_question_unique" ON "matching_answers" USING btree ("profile_id","question_id");
--> statement-breakpoint
CREATE INDEX "matching_answers_profile_id_idx" ON "matching_answers" USING btree ("profile_id");
--> statement-breakpoint
CREATE INDEX "matching_answers_question_id_idx" ON "matching_answers" USING btree ("question_id");
--> statement-breakpoint
INSERT INTO "matching_questions" ("id", "program", "version", "section", "order", "prompt", "help_text", "required", "input_type", "max_length", "websearch", "active") VALUES
('resume', 'tedx', '2026-02-04', 'passive', 1, 'Resume upload (optional)', 'Upload a PDF resume or paste text below. We will convert it to markdown for analysis.', false, 'file_markdown', NULL, false, true),
('linkedin_url', 'tedx', '2026-02-04', 'passive', 2, 'LinkedIn URL (optional)', 'Share your LinkedIn profile to provide professional context.', false, 'url', NULL, true, true),
('links_about_you', 'tedx', '2026-02-04', 'passive', 3, 'Links about you (optional)', 'Personal website, social profiles, blog posts, or anything that represents you.', false, 'multi_url', NULL, true, true),
('links_about_topics', 'tedx', '2026-02-04', 'passive', 4, 'Links about topics you care about (optional)', 'Articles, research, organizations, or media that reflect what you care about.', false, 'multi_url', NULL, true, true),
('q1', 'tedx', '2026-02-04', 'survey', 1, 'What do you do?', 'One or two sentences—how would you describe your work to a curious stranger?', true, 'long_text', 1200, false, true),
('q2', 'tedx', '2026-02-04', 'survey', 2, 'What are you working on right now?', 'What project, problem, or idea is consuming most of your energy these days—professionally or personally?', true, 'long_text', 1200, false, true),
('q3', 'tedx', '2026-02-04', 'survey', 3, 'What do you know deeply?', 'What expertise, skill, or experience do you have that others often ask you about or that you could teach?', true, 'long_text', 1200, false, true),
('q4', 'tedx', '2026-02-04', 'survey', 4, 'What''s an idea you think more people should hear?', 'A belief, insight, or perspective you hold—about your field, the world, or life in general.', true, 'long_text', 1200, false, true),
('q5', 'tedx', '2026-02-04', 'survey', 5, 'What do you believe that most people here might disagree with?', 'A contrarian take, unpopular opinion, or unconventional view you hold.', true, 'long_text', 1200, false, true),
('q6', 'tedx', '2026-02-04', 'survey', 6, 'What are you obsessed with outside of work?', 'Hobbies, interests, rabbit holes, side projects—what fills your time and mind when you''re not working?', true, 'long_text', 1200, false, true),
('q7', 'tedx', '2026-02-04', 'survey', 7, 'What''s something surprising about you?', 'Something that wouldn''t be obvious from your LinkedIn—a hidden interest, unexpected background, or unusual skill.', true, 'long_text', 1200, false, true),
('q8', 'tedx', '2026-02-04', 'survey', 8, 'What are you trying to learn or figure out?', 'What questions are you wrestling with? What skills are you developing? What do you wish you understood better?', true, 'long_text', 1200, false, true),
('q9', 'tedx', '2026-02-04', 'survey', 9, 'What kind of help or connections are you looking for?', 'Introductions, advice, collaborators, feedback, perspectives—what would be most valuable to you right now?', true, 'long_text', 1200, false, true),
('q10', 'tedx', '2026-02-04', 'survey', 10, 'What could you offer someone at this event?', 'What value can you bring—expertise, introductions, mentorship, a sounding board, a specific skill, a unique perspective?', true, 'long_text', 1200, false, true)
ON CONFLICT ("id") DO NOTHING;
