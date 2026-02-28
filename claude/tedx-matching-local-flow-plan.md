# TEDx Asheville Matching Flow Plan (Revised After Review)

Generated: 2026-02-26  
Scope: build and run TEDx matching as a local backend workflow (no UI work), using existing TEDx profile data plus Clay + Jina enrichment.

---

## 1. Objective and Fixed Constraints

### Objective
- Generate top 3 matches per attendee for a ~100-person TEDx cohort.
- Improve match quality by building a final profile card from:
  - TEDx survey answers + resume markdown in `matching_answers`
  - LinkedIn enrichment via Clay webhook callback
  - non-LinkedIn URL enrichment via Jina

### Fixed constraints
- No batch-round scoring phase.
- One final prompt per attendee containing all other candidate cards.
- Output must include top 3 + concrete reasons.

### Non-goals
- No attendee-facing UI in this phase.
- No in-app delivery system in this phase.
- No generalized multi-event matching productization yet.

---

## 2. Codebase Facts This Plan Assumes

- Existing matching data model and onboarding flow are already live:
  - `matching_profiles`, `matching_questions`, `matching_answers`
  - `app/api/matching/*` routes
- `matching_answers` storage behavior:
  - empty answers are deleted (row absent), not stored as null
  - `multi_url` and `multi_text` are stored as flat arrays in `answer_json` (for example `["a", "b"]`)
- Jina usage pattern already exists in repo (`lib/ai/eventVerification.ts`).
- Retry helper already exists (`lib/utils/retry.ts` with `withRetry`).
- Rate limiter helper already exists (`lib/utils/rate-limit.ts` with `isRateLimited`).
- Current consent text mentions AI analysis, but does not explicitly mention third-party LinkedIn enrichment through Clay.

---

## 3. Review-Driven Decisions (Locked In)

1. DB schema will explicitly define:
- `NOT NULL` where required
- `ON DELETE CASCADE` FKs
- `withTimezone: true` for operational timestamps

2. New internal matching pipeline tables will explicitly enable RLS and keep anon/auth policies closed.
- App/server script uses direct DB connection (`db`) and is not blocked.
- We do not expose these tables to client queries.

3. Webhook route will include both auth verification and rate limiting.
- Auth via `verifyAuthToken` (`lib/utils/auth.ts`) using `CLAY_WEBHOOK_SECRET`.
- IP-based throttle via `isRateLimited`.

4. LLM calls in pipeline will use retry + backoff.
- Use `withRetry` wrapper for both enrichment summarization and matching/synthesis calls.

5. JSON-structured outputs are mandatory.
- Use Azure `response_format: { type: "json_object" }` where supported.
- Keep strict validation + repair retry fallback.

6. Script structure will follow repo style.
- Thin script entrypoint in `scripts/`
- Business logic in `lib/matching/`

7. Security hygiene is part of Phase 1.
- Add `exports/tedx-matching/` to `.gitignore`.
- Add missing env docs (`JINA_API_KEY`, Clay secrets/config).
- Define retention policy for enrichment payloads.

---

## 4. Final Target Architecture

1. Start a `matching_run`.
2. Build cohort from submitted/consented TEDx profiles (optionally filtered by roster CSV).
3. Normalize attendee inputs from question/answer rows.
4. Enrich:
- LinkedIn URLs -> Clay async flow + webhook ingestion
- other URLs -> Jina fetch + optional compact summarization
- topic free text -> keep as explicit interests (with domain-like heuristic normalization)
5. Build compact final profile card per attendee.
6. For each attendee, run one all-candidates prompt to get top 3 matches.
7. Persist results and export operational files.

---

## 5. Data Model Additions (Implementation Spec)

Add to `lib/db/schema.ts` and migration SQL.

## 5.1 `matching_runs`
- `id` uuid pk
- `program` text not null
- `cohortLabel` text nullable
- `status` text not null (`created|enriching|synthesizing|matching|completed|failed|interrupted`)
- `configJson` jsonb not null default `'{}'::jsonb`
- `startedAt` timestamptz not null default now
- `completedAt` timestamptz nullable
- `createdAt` timestamptz not null default now
- `updatedAt` timestamptz not null default now

## 5.2 `matching_enrichment_items`
- `id` uuid pk
- `runId` uuid not null fk -> `matching_runs.id` `ON DELETE CASCADE`
- `profileId` uuid not null fk -> `matching_profiles.id` `ON DELETE CASCADE`
- `sourceKind` text not null (`linkedin|url|topic_text`)
- `sourceValue` text not null
- `sourceHash` text not null (sha256 of normalized source; avoids long-text index issues)
- `provider` text not null (`clay|jina|manual`)
- `status` text not null (`pending|completed|failed|timeout|skipped`)
- `externalId` text nullable
- `rawPayload` jsonb nullable
- `normalizedText` text nullable
- `httpStatus` integer nullable
- `errorText` text nullable
- `createdAt` timestamptz not null default now
- `updatedAt` timestamptz not null default now

Indexes:
- unique `(run_id, profile_id, source_kind, provider, source_hash)`
- index `(run_id, status)`
- index `(run_id, provider, source_hash)` for cross-attendee cache lookup
- index `(external_id)` where not null

## 5.3 `matching_profile_cards`
- `id` uuid pk
- `runId` uuid not null fk -> `matching_runs.id` `ON DELETE CASCADE`
- `profileId` uuid not null fk -> `matching_profiles.id` `ON DELETE CASCADE`
- `cardJson` jsonb not null
- `cardText` text not null
- `model` text not null
- `promptVersion` text not null
- `createdAt` timestamptz not null default now
- `updatedAt` timestamptz not null default now

Indexes:
- unique `(run_id, profile_id)`

## 5.4 `matching_top_matches`
- `id` uuid pk
- `runId` uuid not null fk -> `matching_runs.id` `ON DELETE CASCADE`
- `profileId` uuid not null fk -> `matching_profiles.id` `ON DELETE CASCADE`
- `matchesJson` jsonb not null
- `model` text not null
- `promptVersion` text not null
- `createdAt` timestamptz not null default now
- `updatedAt` timestamptz not null default now

Indexes:
- unique `(run_id, profile_id)`

## 5.5 RLS policy stance
- Explicitly `ENABLE ROW LEVEL SECURITY` on all four tables.
- No anon/auth policies for read/write.
- These are internal pipeline tables, accessed from server only.

---

## 6. Cohort and Input Normalization Rules

## 6.1 Cohort selection
Primary:
- `program='tedx' AND status='submitted' AND ai_matching=true`

Optional filter:
- intersection with roster CSV by email/user_id

Output a cohort audit:
- included count
- excluded (not found / not submitted / no consent)
- duplicate keys

## 6.2 Answer extraction rules
- Missing answers mean missing rows: code must handle absent records gracefully.
- `resume` is markdown text (`answer_text`), not plain text.
- `links_about_you` and `links_about_topics` are flat string arrays in `answer_json`.

## 6.3 Topic URL heuristic
For `links_about_topics` entries:
- if valid absolute URL -> URL
- else if domain-like string (for example `marginalrevolution.com`) -> coerce to `https://...` and validate
- else keep as plain topic text

## 6.4 LinkedIn detection rules
- classify as LinkedIn if host/path matches:
  - `linkedin.com/in/*`
  - `linkedin.com/pub/*`
  - `lnkd.in/*` (resolve redirect before classification)
- non-profile LinkedIn pages (`/company`, `/school`) are not sent to Clay profile enrichment.

---

## 7. Clay Integration Plan (Now Unblocked)

## 7.1 Phase 0 contract capture (required before webhook implementation)
- Create a Clay test row and capture one real webhook payload.
- Save sample payload in `claude/` fixture file.
- Finalize adapter mapping (`external_ref`, `status`, enriched fields, error fields).

## 7.2 Webhook endpoint
- Route: `app/api/matching/clay/linkedin-webhook/route.ts`
- Security:
  - `verifyAuthToken(authHeader, process.env.CLAY_WEBHOOK_SECRET)`
  - `isRateLimited("clay-webhook:<ip>", limit, window)`
- Processing:
  - parse/validate body
  - map payload through adapter
  - upsert `matching_enrichment_items`
  - return fast `200`

## 7.3 Local runtime dependency
- Because webhook is a Next route, local matching run requires:
  - `npm run dev` running
  - a public tunnel URL for Clay callbacks (for example ngrok/cloudflared)

Script wait loop:
- poll pending Clay rows for `run_id` every 15s
- timeout configurable (default 30m), mark remaining `timeout`

---

## 8. Jina Enrichment Plan

## 8.1 Fetch behavior
- Use shared helper in `lib/matching/enrichment/jina.ts`.
- `withRetry` on retryable statuses (429, 5xx, network timeout).
- Do not retry non-retryable statuses (404, 410, invalid URL).
- store `httpStatus` and `errorText`.

## 8.2 Content limits
- raw markdown cap: 20,000 chars
- normalized summary cap (if summarized): 1,500 chars

## 8.3 Cross-attendee dedupe
- Before fetch, check `matching_enrichment_items` for same `(run_id, provider='jina', source_hash, status='completed')`.
- Reuse existing normalized text instead of fetching again.
- Maintain in-memory map during run for additional speed.

---

## 9. LLM Strategy (Synthesis + Matching)

## 9.1 Prompt outputs
- Synthesis and matching prompts both require strict JSON output.
- Use Azure JSON mode (`response_format: { type: "json_object" }`) where supported.
- Keep fallback:
  - parse failure -> repair prompt retry
  - hard failure -> mark row failed with error

## 9.2 Retry policy
- Wrap each LLM call in `withRetry` (exponential backoff).
- Explicit handling for 429 and transient 5xx.

## 9.3 Token/throughput controls
- Target `card_text` length: 120-220 words.
- Matching call concurrency default: 1-2.
- Add preflight quota check:
  - verify deployment TPM/RPM in Azure before full 100-person run.

## 9.4 Determinism note
- `gpt-5-mini` does not expose temperature in current wrapper path.
- We rely on prompt constraints + schema validation instead of temperature tuning.

---

## 10. Script and Module Layout (Repo-Aligned)

## 10.1 Entrypoint
- `scripts/tedx-matching.ts` (or `scripts/matching/tedx.ts`)

## 10.2 Library modules
- `lib/matching/pipeline/run.ts`
- `lib/matching/pipeline/cohort.ts`
- `lib/matching/pipeline/normalize.ts`
- `lib/matching/pipeline/enrich-clay.ts`
- `lib/matching/pipeline/enrich-jina.ts`
- `lib/matching/pipeline/synthesize-cards.ts`
- `lib/matching/pipeline/generate-matches.ts`
- `lib/matching/pipeline/export.ts`
- `lib/matching/pipeline/types.ts`

## 10.3 Runtime hardening
- trap `SIGINT`/`SIGTERM`
- mark run `interrupted`
- flush progress and exit cleanly
- ensure `process.exit()` in success/failure paths (consistent with current script patterns)

---

## 11. Security and Privacy Requirements

1. Add to `.gitignore`:
- `exports/tedx-matching/`

2. Add to `.env.example`:
- `JINA_API_KEY=`
- `CLAY_WEBHOOK_SECRET=`
- `CLAY_API_KEY=`
- `CLAY_TABLE_ID=` (or equivalent config used by integration)

3. Retention policy:
- `rawPayload` default retained 30 days max, then purge or null out
- keep normalized summary + status for audit

4. Consent gate:
- Before enabling Clay in production runs, confirm legal/product approval that consent copy covers third-party enrichment.
- If not approved, run with `--skip-clay` until consent copy is updated.

---

## 12. Exports and Deliverables

Output path:
- `exports/tedx-matching/<run_id>/`

Files:
- `cohort.json`
- `enrichment-status.json`
- `profile-cards.json`
- `matches.json`
- `matches.csv`
- `matches.md`

DB remains source of truth for resumability and audits.

---

## 13. Implementation Phases (Ready to Execute)

## Phase 0: Contract and Risk Preflight
- capture Clay webhook sample payload
- confirm Azure quota (TPM/RPM) for target deployment
- confirm consent/legal stance on Clay usage

Done when:
- payload fixture approved
- quota documented
- consent gate decision documented

## Phase 1: Foundations
- add new schema + migrations + indexes + RLS settings
- add webhook route with auth + rate limiting
- add env docs and `.gitignore` update

Done when:
- migration applies cleanly
- webhook endpoint accepts valid signed payload and rejects invalid/rate-limited requests

## Phase 2: Pipeline Core
- implement cohort load + answer normalization
- implement Clay enqueue/poll
- implement Jina enrichment with dedupe + retry classes

Done when:
- 10-person dry run completes enrichment end-to-end with resumability

## Phase 3: Synthesis + Matching
- implement profile card synthesis
- implement one-pass top-3 matching per attendee
- strict schema validation + repair retries

Done when:
- >=95% attendees produce valid cards and top-3 match objects

## Phase 4: Ops Outputs
- add exports and run summary
- add retention cleanup task for stale raw payloads

Done when:
- outputs generated for run
- cleanup job/command documented and tested

---

## 14. Operator Runbook (Local)

1. Start app server:
- `npm run dev`

2. Start tunnel for webhook callback URL.

3. Run matching script:
- `tsx scripts/tedx-matching.ts --program tedx --cohort-file claude/data/tedx-attendees.csv --run-label tedx-2026-main`

4. Monitor run status in logs and DB tables.

5. Export and review `exports/tedx-matching/<run_id>/matches.md`.

---

## 15. Remaining Open Decisions

1. Cohort source of truth:
- roster CSV required vs optional

2. Final outbound format to stakeholders:
- markdown only vs markdown + CSV packet

All previous technical blockers identified in review are now either resolved in this plan or moved to an explicit Phase 0 gate.
