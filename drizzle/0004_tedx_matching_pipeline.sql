CREATE TABLE "matching_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "program" text NOT NULL,
  "cohort_label" text,
  "status" text NOT NULL,
  "config_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "matching_enrichment_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "run_id" uuid NOT NULL,
  "profile_id" uuid NOT NULL,
  "source_kind" text NOT NULL,
  "source_value" text NOT NULL,
  "source_hash" text NOT NULL,
  "provider" text NOT NULL,
  "status" text NOT NULL,
  "external_id" text,
  "raw_payload" jsonb,
  "normalized_text" text,
  "http_status" integer,
  "error_text" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "matching_enrichment_items_run_id_matching_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "matching_runs"("id") ON DELETE cascade,
  CONSTRAINT "matching_enrichment_items_profile_id_matching_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "matching_profiles"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE "matching_profile_cards" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "run_id" uuid NOT NULL,
  "profile_id" uuid NOT NULL,
  "card_json" jsonb NOT NULL,
  "card_text" text NOT NULL,
  "model" text NOT NULL,
  "prompt_version" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "matching_profile_cards_run_id_matching_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "matching_runs"("id") ON DELETE cascade,
  CONSTRAINT "matching_profile_cards_profile_id_matching_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "matching_profiles"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE "matching_top_matches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "run_id" uuid NOT NULL,
  "profile_id" uuid NOT NULL,
  "matches_json" jsonb NOT NULL,
  "model" text NOT NULL,
  "prompt_version" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "matching_top_matches_run_id_matching_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "matching_runs"("id") ON DELETE cascade,
  CONSTRAINT "matching_top_matches_profile_id_matching_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "matching_profiles"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX "matching_runs_program_idx" ON "matching_runs" USING btree ("program");
--> statement-breakpoint
CREATE INDEX "matching_runs_status_idx" ON "matching_runs" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "matching_runs_started_at_idx" ON "matching_runs" USING btree ("started_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "matching_enrichment_items_run_profile_source_unique" ON "matching_enrichment_items" USING btree ("run_id","profile_id","source_kind","provider","source_hash");
--> statement-breakpoint
CREATE INDEX "matching_enrichment_items_run_status_idx" ON "matching_enrichment_items" USING btree ("run_id","status");
--> statement-breakpoint
CREATE INDEX "matching_enrichment_items_run_provider_hash_idx" ON "matching_enrichment_items" USING btree ("run_id","provider","source_hash");
--> statement-breakpoint
CREATE INDEX "matching_enrichment_items_external_id_idx" ON "matching_enrichment_items" USING btree ("external_id") WHERE "external_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "matching_profile_cards_run_profile_unique" ON "matching_profile_cards" USING btree ("run_id","profile_id");
--> statement-breakpoint
CREATE INDEX "matching_profile_cards_run_id_idx" ON "matching_profile_cards" USING btree ("run_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "matching_top_matches_run_profile_unique" ON "matching_top_matches" USING btree ("run_id","profile_id");
--> statement-breakpoint
CREATE INDEX "matching_top_matches_run_id_idx" ON "matching_top_matches" USING btree ("run_id");
--> statement-breakpoint
ALTER TABLE "matching_runs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "matching_enrichment_items" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "matching_profile_cards" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "matching_top_matches" ENABLE ROW LEVEL SECURITY;
