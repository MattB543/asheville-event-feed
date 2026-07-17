/**
 * Extract Facebook scraper credentials from a browser HAR export and update .env in place.
 *
 * Usage: npx tsx scripts/extract-fb-creds.ts <path-to-har>
 *
 * The HAR must contain a logged-in POST to facebook.com/api/graphql/ WITH its
 * Cookie header. Firefox HAR exports include cookies; Chrome strips them (use
 * Firefox, or Chrome DevTools "Copy as cURL" + manual paste instead).
 *
 * Then verify with: npx tsx scripts/run-facebook-local.ts
 */
import fs from 'node:fs';
import path from 'node:path';

const harPath = process.argv[2];
if (!harPath) {
  console.error('Usage: npx tsx scripts/extract-fb-creds.ts <path-to-har>');
  process.exit(1);
}
const envPath = path.join(__dirname, '..', '.env');

const har = JSON.parse(fs.readFileSync(harPath, 'utf8'));

// Find a graphql POST with a Cookie header and fb_dtsg in the body
let match: { cookie: string; body: string } | null = null;
for (const entry of har.log.entries) {
  const req = entry.request;
  if (req.method !== 'POST' || !req.url.includes('/api/graphql')) continue;
  const cookieHdr = (req.headers || []).find(
    (h: { name: string }) => h.name.toLowerCase() === 'cookie'
  );
  const body = req.postData?.text || '';
  if (cookieHdr && body.includes('fb_dtsg=')) {
    match = { cookie: cookieHdr.value, body };
    break;
  }
}
if (!match) {
  console.error(
    'No usable entry found: need a POST to /api/graphql/ with a Cookie header and fb_dtsg in the body.\n' +
      'If the HAR came from Chrome, cookies were stripped — re-export from Firefox.'
  );
  process.exit(1);
}

const cookies: Record<string, string> = {};
for (const part of match.cookie.split(/;\s*/)) {
  const i = part.indexOf('=');
  if (i > 0) cookies[part.slice(0, i)] = part.slice(i + 1);
}
const form: Record<string, string> = {};
for (const part of match.body.split('&')) {
  const i = part.indexOf('=');
  if (i > 0) form[part.slice(0, i)] = part.slice(i + 1);
}

// Encoding rules (see lib/scrapers/facebook-discover.ts):
// - FB_XS keeps its URL-encoding (%3A) — Playwright sends cookie values verbatim.
// - FB_DTSG is stored DECODED (literal colons) — the scraper re-encodes via params.append.
const updates: Record<string, string | undefined> = {
  FB_C_USER: cookies.c_user,
  FB_XS: cookies.xs,
  FB_FR: cookies.fr,
  FB_DATR: cookies.datr,
  FB_SB: cookies.sb,
  FB_DTSG: form.fb_dtsg && decodeURIComponent(form.fb_dtsg),
  FB_LSD: form.lsd && decodeURIComponent(form.lsd),
  FB_JAZOEST: form.jazoest,
  FB_USER: form.__user,
  FB_REV: form.__rev,
};

const missing = Object.entries(updates)
  .filter(([, v]) => !v)
  .map(([k]) => k);
if (missing.length) {
  console.error('Missing values in HAR: ' + missing.join(', '));
  process.exit(1);
}

// Sanity check: the session sequence number in xs ("<seq>:...") must match dtsg ("...:<seq>:ts")
const xsSeq = decodeURIComponent(updates.FB_XS!).split(':')[0];
const dtsgSeq = updates.FB_DTSG!.split(':')[1];
if (xsSeq !== dtsgSeq) {
  console.warn(
    `WARNING: xs seq (${xsSeq}) != dtsg seq (${dtsgSeq}) — cookie and token may be from different sessions`
  );
}

let env = fs.readFileSync(envPath, 'utf8');
for (const [key, val] of Object.entries(updates) as [string, string][]) {
  const re = new RegExp(`^${key}=.*$`, 'm');
  if (!re.test(env)) {
    console.error(`Key ${key} not found in .env — add it manually first`);
    process.exit(1);
  }
  env = env.replace(re, () => `${key}=${val}`);
  console.log(`${key} -> ${val.slice(0, 6)}... (len ${val.length})`);
}
fs.writeFileSync(envPath, env);
console.log('.env updated. Verify with: npx tsx scripts/run-facebook-local.ts');
