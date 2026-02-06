# Profile Matching Flow — Phase 1 Plan (TEDx pilot, generic architecture)

## Decisions captured from you (final)
- `/tedx` is unlinked (no nav button). You’ll share the URL directly.
- Use existing AVLGO auth (Google + magic link).
- Users opt-in via `ai_matching` boolean (explicit consent), mirrored into `user_preferences`.
- Survey questions are DB‑driven.
- Passive inputs (LinkedIn/resume/links) are treated as open-ended questions; `websearch` applies only to these (not written answers).
- Resume file should **not** be stored; convert to markdown and save text only. PDF only + allow manual paste fallback.
- Answers are **not editable after submit**; draft autosave is desired. Read-only view after submit with "email support@avlgo.com to update."
- Require a confirmation modal before final submission.
- Use the same `Header` component.
- Naming should be generic (not TEDx-specific) to support other cohorts later.
- Single matching profile per user (no multi-cohort profiles yet).
- Links have no hard limit.
- Show entry on `/profile` only if survey started.
- Display name defaults to auth name, then email prefix; user can override.
- Resume max size is 10 MB.

---

## Execution notes (what was implemented)
### Schema + migrations
- Added `matching_profiles`, `matching_questions`, `matching_answers`.
- Added `user_preferences.ai_matching`.
- Seeded TEDx question set in migration SQL (version `2026-02-04`).

### API routes
- `GET/POST /api/matching/profile` for profile fetch + upsert (mirrors `ai_matching` to `user_preferences`).
- `POST /api/matching/answers` for draft answer upserts with validation.
- `POST /api/matching/submit` to lock submissions and enforce consent + required answers.
- `POST /api/matching/resume` to parse PDF → markdown (no file storage).

### Auth & routing
- `/login` honors `next` for magic link and Google.
- `GoogleSignInButton` accepts `redirectTo`.
- `/tedx` and `/tedx/onboarding` set `robots: { index: false, follow: false }`.

### UI
- `/tedx` landing page with CTA state (new/continue/submitted).
- `/tedx/onboarding` multi-step flow with autosave every 10s.
- Read-only state once submitted with support email notice.
- `/profile` shows Matching Profile tile only if a profile exists.

### Resume parsing details
- PDF only, max 10 MB.
- Parsed text normalized and truncated to 20k chars.
- Manual paste textarea available as fallback.

---

## Repo context (relevant patterns)
- Next.js App Router + Tailwind v4, shared `Header`, `Toast`, modal patterns (e.g. `SaveFeedModal`).
- Auth via Supabase (`/login`, `auth/confirm`, `GoogleSignInButton`).
- DB access via Drizzle (`lib/db/schema.ts`, `lib/db/index.ts`) and server‑side auth check in API routes.

---

## Phase 1 scope
**Deliverables**
1. `/tedx` landing page (unlisted) → CTA into onboarding.
2. Multi‑step onboarding flow: consent + passive inputs + 10 long‑form questions + review/submit.
3. Draft autosave + prefill on return.
4. Persist profile + answers in DB.
5. Lock edits after submit.

**Out of scope (Phase 2)**
- Summaries/embeddings/matching logic.
- Admin UI for editing questions.

---

## Data model (generic, DB‑driven)
### Tables (recommended)
**`matching_profiles`**
- `id` uuid pk
- `user_id` uuid unique (FK to auth.users)
- `program` text (still useful for future cohorts, but **user_id is unique** for now)
- `display_name` text (optional)
- `email` text (optional, from auth)
- `ai_matching` boolean default false
- `consent_at` timestamptz (when user opts‑in)
- `consent_version` text (ties to question version)
- `status` text (`draft` | `submitted`) default `draft`
- `submitted_at` timestamptz
- `created_at`, `updated_at`

**`matching_questions`**
- `id` text or uuid pk
- `program` text
- `version` text (e.g. `2026-02-04`)
- `section` text (`passive` | `survey`)
- `order` int
- `prompt` text
- `help_text` text
- `required` boolean
- `input_type` text (`long_text`, `short_text`, `url`, `multi_url`, `file_markdown`)
- `max_length` int
- `websearch` boolean default false (only used for passive/link inputs)
- `active` boolean default true

**`matching_answers`**
- `id` uuid pk
- `profile_id` uuid FK -> `matching_profiles.id`
- `question_id` text/uuid
- `answer_text` text
- `answer_json` jsonb (arrays, structured types)
- `updated_at`, `created_at`
- unique (`profile_id`, `question_id`)

**`user_preferences`** (existing)
- Add `ai_matching` boolean default false (mirrors opt-in).

### Why this shape
- Generic enough for future cohorts/events.
- DB‑driven question updates without deploy.
- Supports passive inputs and open-ended questions uniformly.
- Keeps a single profile per user while preserving future program expansion.

---

## Survey + Passive Inputs (DB seed)
Seed `matching_questions` for `program='tedx'` + `version='2026-02-04'`:

**Passive inputs (section = `passive`)**
1. Resume upload (input_type=`file_markdown`, required=false, websearch=false, PDF only)
2. LinkedIn URL (input_type=`url`, websearch=true)
3. Links about you (input_type=`multi_url`, websearch=true)
4. Links about topics you care about (input_type=`multi_url`, websearch=true)

**Survey questions (section = `survey`)**
- Q1–Q10 from `profile-matching-plan.md` with `input_type='long_text'`.
- `websearch=false` for all written questions.

---

## API routes (Phase 1)
**`GET /api/matching/profile?program=tedx`**
- Auth required. Returns profile + answers + question version.

**`POST /api/matching/profile`**
- Upsert profile fields (`display_name`, `ai_matching`, `consent_at`, `consent_version`, `status`).
- Mirror `ai_matching` into `user_preferences`.
- Reject updates if `status=submitted`.

**`POST /api/matching/answers`**
- Upsert answer(s) by question id.
- Validate against `matching_questions` (required, max length, input_type).
- Reject if `status=submitted`.

**`POST /api/matching/submit`**
- Validate required answers, `ai_matching=true`, `consent_at` set.
- Set status `submitted` + `submitted_at`.

**`POST /api/matching/resume`**
- Accept `multipart/form-data`, parse resume PDF to markdown, save to resume question answer.
- Do not store original file. Allow manual paste fallback.

---

## UI/UX (Phase 1)
### `/tedx` landing
- Uses `Header`.
- Brief copy + “Start profile matching” CTA.
- If unauthenticated, show sign-in CTA to `/login?next=/tedx/onboarding`.

### `/tedx/onboarding`
- Client component (multi‑step).
- Steps:
  1. Consent + basic profile fields (display name).
  2. Passive inputs (resume upload, LinkedIn, links).
  3. 10 long‑form questions.
  4. Review + “Submit” button → confirmation modal.

### Confirmation modal
- Modal copy: “Are you sure? You can’t edit after submit.”
- On confirm → call `/api/matching/submit`.

### Draft autosave
- Debounced autosave every 10s (or on field blur + interval).
- Load existing draft on mount.
- If `status=submitted`, show read-only “submitted” state + support email.

---

## Auth + Redirects
- Update `/login` to respect `next` query param.
- Magic link: `emailRedirectTo` should include `next` (e.g. `/auth/confirm?next=/tedx/onboarding`).
- `GoogleSignInButton` should accept `redirectTo` prop (default `/events`).

---

## Resume → Markdown parsing
**Server path**: `/api/matching/resume`
- Accept PDF only.
- Add max size limit (proposed: 10 MB) and show validation errors.
- Convert to markdown (best‑effort), store as answer_text for resume question.
- If parsing fails, return error + allow manual paste fallback.

---

## Drizzle migration plan
1. Extend `lib/db/schema.ts` with new matching tables.
2. Generate migration SQL + apply.
3. Seed `matching_questions` (migration insert or seed script in `scripts/`).

---

## QA checklist
- Auth redirect returns to `/tedx/onboarding` after login.
- Draft autosave persists and reloads.
- Submit locks answers.
- Resume upload converts to markdown and is saved.
- Required fields enforced; error states displayed.

---

## Deployment / execution steps
1. Run migrations (preferred) so the seed executes:
   - Use your normal Drizzle migration flow to apply `drizzle/0002_matching_profiles.sql`.
2. If you use `drizzle-kit push` instead:
   - Tables will be created but the seed **will not run**. Manually run the INSERTs in `drizzle/0002_matching_profiles.sql`.
3. Verify Supabase env vars (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`).
4. Sanity-check `/tedx` and `/tedx/onboarding` in dev.

---

## Files touched (implementation)
- `lib/db/schema.ts`
- `drizzle/0002_matching_profiles.sql`
- `drizzle/meta/_journal.json`
- `app/api/matching/profile/route.ts`
- `app/api/matching/answers/route.ts`
- `app/api/matching/submit/route.ts`
- `app/api/matching/resume/route.ts`
- `components/matching/MatchingOnboardingClient.tsx`
- `components/matching/ConfirmSubmitModal.tsx`
- `app/tedx/page.tsx`
- `app/tedx/onboarding/page.tsx`
- `app/login/page.tsx`
- `components/GoogleSignInButton.tsx`
- `app/profile/page.tsx`
- `package.json`
- `package-lock.json`

---

## Remaining decisions
- None (display name defaults to auth name, fallback email prefix; resume max size is 10 MB).
