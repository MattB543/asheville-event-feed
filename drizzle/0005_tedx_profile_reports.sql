CREATE TABLE "matching_profile_reports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "run_id" uuid NOT NULL,
  "profile_id" uuid NOT NULL,
  "report_json" jsonb NOT NULL,
  "report_text" text NOT NULL,
  "model" text NOT NULL,
  "prompt_version" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "matching_profile_reports_run_id_matching_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "matching_runs"("id") ON DELETE cascade,
  CONSTRAINT "matching_profile_reports_profile_id_matching_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "matching_profiles"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX "matching_profile_reports_run_profile_unique" ON "matching_profile_reports" USING btree ("run_id","profile_id");
--> statement-breakpoint
CREATE INDEX "matching_profile_reports_run_id_idx" ON "matching_profile_reports" USING btree ("run_id");
--> statement-breakpoint
ALTER TABLE "matching_profile_reports" ENABLE ROW LEVEL SECURITY;
