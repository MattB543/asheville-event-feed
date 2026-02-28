ALTER TABLE "matching_enrichment_items"
  ADD COLUMN IF NOT EXISTS "source_survey_updated_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "matching_profile_reports"
  ADD COLUMN IF NOT EXISTS "source_survey_updated_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "matching_profile_cards"
  ADD COLUMN IF NOT EXISTS "source_survey_updated_at" timestamp with time zone;
