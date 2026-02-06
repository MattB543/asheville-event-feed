# Matching Feature — Code Review & Fixes

Review of the Phase 1 matching/TEDx implementation against `claude/tedx-matching-phase1-plan.md`. All issues below were identified and fixed in a single pass.

---

## HIGH Severity

### 1. Open redirect vulnerability in `/auth/confirm`

**File:** `app/auth/confirm/route.ts`

**Problem:** The `next` query parameter was read directly from the URL with zero sanitization and used in `NextResponse.redirect(origin + next)`. An attacker could craft a magic link URL like `/auth/confirm?token_hash=xxx&next=//evil.com` to redirect users to a malicious domain after authentication. This bypassed the client-side sanitization done in the login page because `/auth/confirm` is a server-side route directly accessible via URL.

**Fix:** Added validation requiring `next` to start with `/` and NOT start with `//`. Falls back to `'/'` if invalid. Applied the same `!startsWith('//')` guard to `app/login/page.tsx` and `components/GoogleSignInButton.tsx` which had the `startsWith('/')` check but were also vulnerable to protocol-relative URLs.

**Files changed:**
- `app/auth/confirm/route.ts`
- `app/login/page.tsx`
- `components/GoogleSignInButton.tsx`

---

### 2. `pdf-parse` API usage broken at runtime

**File:** `app/api/matching/resume/route.ts`

**Problem:** The route used `import { PDFParse } from 'pdf-parse'` and instantiated it as `new PDFParse({ data: buffer })` with `.getText()` / `.destroy()`. The `pdf-parse` npm package does not export this API — neither v1 nor v2. This would crash at runtime with an import error or "PDFParse is not a constructor". Additionally, `@types/pdf-parse@1.1.5` (v1 types) was installed alongside `pdf-parse@^2.4.5` (v2 code), a version mismatch. The types package was also incorrectly placed in `dependencies` instead of `devDependencies`.

**Fix:** Replaced `pdf-parse` entirely with Google Gemini (`gemini-2.5-flash`), which was already configured in the project. The route now:
- Converts the uploaded PDF to base64
- Sends it as inline data with `mimeType: 'application/pdf'` to Gemini
- Asks Gemini to convert the content to clean, structured markdown
- Preserves headings, lists, bold/italic, and document sections
- Returns 503 with a user-friendly message if `GEMINI_API_KEY` is not configured
- Gracefully falls back to "paste manually" messaging on any error

Removed `pdf-parse` and `@types/pdf-parse` from `package.json` and ran `npm install` to clean the lockfile.

**Files changed:**
- `app/api/matching/resume/route.ts` (rewritten)
- `package.json` (removed 2 dependencies)
- `package-lock.json` (updated)

---

## MEDIUM Severity

### 3. Stale closure in autosave interval

**File:** `components/matching/MatchingOnboardingClient.tsx`

**Problem:** The `setInterval` autosave `useEffect` had `[isSubmitted, version]` as its dependency array. It captured `saveDraft` from the initial render, which in turn called `saveProfile`, which read `displayName` and `aiMatching` directly from React state. If either value changed without `isSubmitted` or `version` changing, the 10-second autosave would write stale values. The `answersRef` pattern already solved this for answers but was not applied to profile fields.

**Fix:** Added `displayNameRef` and `aiMatchingRef` refs that stay in sync with their state counterparts via a sync effect. Updated `saveProfile` to read from `displayNameRef.current` and `aiMatchingRef.current` instead of from state.

---

### 4. URL validation too strict for draft saves

**File:** `app/api/matching/answers/route.ts`

**Problem:** The answers API strictly validated URLs and returned 400 for invalid ones. During the 10-second autosave, a partially-typed URL (e.g., `https://li`) triggered "Autosave failed" toast errors in the UI. This was disruptive during normal typing.

**Fix:**
- For `url` input type: invalid URLs are now silently treated as empty (the answer row is deleted), matching the behavior of other cleared fields.
- For `multi_url` input type: invalid entries are silently filtered out, keeping only valid URLs. The `normalizeUrlList` function was simplified to only return `{ urls: string[] }` since the `invalid` array is no longer needed.

---

### 5. `readOnly` vs `disabled` inconsistency in submitted state

**File:** `components/matching/MatchingOnboardingClient.tsx`

**Problem:** Step 1 fields used `disabled={isSubmitted}` which activates `disabled:opacity-70` Tailwind styling (visually grayed out). Steps 2 and 3 used `readOnly={isSubmitted}`, which prevents editing but does NOT activate the disabled class — fields looked normal but were non-interactive, creating a confusing visual inconsistency.

**Fix:** Changed all `readOnly={isSubmitted}` to `disabled={isSubmitted}` on textareas and inputs in Steps 2-3 (file_markdown textarea, url input, multi_url inputs, survey question textareas).

---

### 6. Failed `saveDraft` doesn't prevent submission modal

**File:** `components/matching/MatchingOnboardingClient.tsx`

**Problem:** `handleSubmitClick` called `await saveDraft()` and then immediately opened the confirmation modal with `setConfirmOpen(true)`, regardless of whether the save succeeded. A failed save showed an error toast but the modal still opened, allowing the user to submit potentially unsaved data.

**Fix:** Changed `saveDraft` to return `Promise<boolean>` — `true` on success (or nothing to save), `false` on error. `handleSubmitClick` now checks the return value and only opens the modal if the save succeeded.

---

## LOW Severity / Code Quality

### 7. Duplicated utility functions across API routes

**Files:** `app/api/matching/profile/route.ts`, `app/api/matching/answers/route.ts`, `app/api/matching/submit/route.ts`

**Problem:** Three functions were copy-pasted across all route files: `getSafeProgram`, `getDefaultDisplayName`, and `getLatestQuestions`, plus the `DEFAULT_PROGRAM` constant.

**Fix:** Created `lib/matching/utils.ts` with all shared functions. Updated all 3 route files to import from there. Cleaned up unused imports in each route file.

**Files changed:**
- `lib/matching/utils.ts` (new)
- `app/api/matching/profile/route.ts`
- `app/api/matching/answers/route.ts`
- `app/api/matching/submit/route.ts`

---

### 8. No `maxLength` enforcement for `file_markdown` input type

**File:** `app/api/matching/answers/route.ts`

**Problem:** The `file_markdown` input type handler had no length check. The resume route truncates to 20k chars, but text submitted directly through the answers endpoint (via the paste fallback) had no length cap, allowing arbitrarily large text.

**Fix:** Added a `maxLength` check for `file_markdown` using `question.maxLength` if set, defaulting to 20,000 characters. Returns 400 with a descriptive error if exceeded, matching the pattern used by `long_text`/`short_text`.

---

### 9. Profile page crashes if matching table doesn't exist

**File:** `app/profile/page.tsx`

**Problem:** The `matchingProfiles` database query ran without error handling. If the migration hasn't been applied yet (or the DB connection fails), this crashes the entire profile page with a 500 error — taking down account details, email digest settings, curator settings, and everything else on the page.

**Fix:** Wrapped the query in a try/catch. On failure, `matchingProfile` is set to `null` and the page renders normally without the matching tile. A brief comment explains the rationale.

---

### 10. Confirm modal accessibility gaps

**File:** `components/matching/ConfirmSubmitModal.tsx`

**Problems:**
- No keyboard `Escape` handler to close the modal
- No focus trap — Tab could navigate behind the modal
- Backdrop click and X button were not disabled during submission, allowing the user to dismiss the modal mid-API call

**Fixes:**
- Added `useEffect` with `keydown` listener for Escape (disabled when `isSubmitting`)
- Added `onKeyDown` handler on the modal container that traps Tab/Shift+Tab focus within focusable elements
- Backdrop `onClick` and X button `onClick` now check `isSubmitting` before calling `onClose`; X button also has `disabled={isSubmitting}` with matching styling

---

### 11. Unstable React keys for dynamic URL lists

**File:** `components/matching/MatchingOnboardingClient.tsx`

**Problem:** Multi-URL list items used `${question.id}-${index}` as the React key. Deleting a URL from the middle shifts all subsequent indices, causing React to incorrectly reuse DOM nodes and potentially lose input focus or show wrong values.

**Fix:** Changed to `${question.id}-${value || `empty-${index}`}`. When a URL has a value, the URL string itself serves as a stable key. Empty inputs (newly added blanks) fall back to index to avoid duplicate empty-string keys.

---

## Not Fixed — Remaining Items

### Missing Review Step (Step 4)

The plan specifies 4 steps: Consent, Context, Questions, Review. The implementation has 3 steps with the Submit button directly on the Questions step. There is no review screen showing a read-only summary of all answers before confirmation. This is the most significant plan deviation. Decision needed on whether to add it.

### Minor observations (not fixed, acceptable)

- **Inconsistent timestamp timezone usage:** `consent_at` and `submitted_at` use `timestamp with time zone`, but `created_at` and `updated_at` use plain `timestamp`. This is inherited from the existing codebase pattern (the `events` table does the same) and is not a new issue.
- **`user_preferences.ai_matching` is nullable** while `matching_profiles.ai_matching` is `NOT NULL`. Functionally fine since `null` is treated as `false`.
- **No `onBlur` autosave:** The plan mentioned "on field blur + interval" but only the 10-second interval is implemented. The interval alone is sufficient for the use case.
- **No rate limiting on matching endpoints:** Low priority since the URL is unlisted.
- **No program allowlist validation:** `getSafeProgram` accepts arbitrary strings. Not a security issue (Drizzle parameterizes queries) but could result in invalid data. Acceptable for a single-program pilot.
