-- The news-ai lease: see docs/news/05-v1-plan.md §6.2 and acquireNewsAiLease()
-- in lib/news/pipeline.ts.
--
-- A news-ai run's own cron_job_runs row is its lease. This index lets only one
-- news-ai row be 'running' at a time, so of two runs starting together the
-- second one's insert fails with a unique violation (23505) and that run skips
-- itself. acquireNewsAiLease() first fails any news-ai row still running after
-- 15 minutes (a run that died without recording its end).
--
-- Only news-ai rows in 'running' are constrained; every other job is
-- unaffected. Idempotent. Applied by scripts/news/migrate.ts.

CREATE UNIQUE INDEX IF NOT EXISTS "cron_job_runs_one_running_news_ai"
  ON "cron_job_runs" ("job_name")
  WHERE "status" = 'running' AND "job_name" = 'news-ai';
