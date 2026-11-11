/**
 * Gets a new SPOTIFY_REFRESH_TOKEN: sign in as the playlist's owner, click Agree, and the
 * token is printed for Vercel. The app needs REDIRECT_URI listed under its Redirect URIs.
 * Usage: npm run playlist:login (asks for the client ID and secret)
 */
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createInterface } from 'node:readline/promises';

// Spotify accepts plain http only for a loopback IP, not "localhost"
const REDIRECT_URI = 'http://127.0.0.1:8888/callback';
const SCOPES = 'playlist-modify-public playlist-modify-private';

async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(question);
  rl.close();
  return answer.trim();
}

async function run() {
  const clientId = process.env.SPOTIFY_CLIENT_ID || (await ask('Client ID: '));
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET || (await ask('Client secret: '));
  const state = randomBytes(16).toString('hex');

  const codePromise = new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', REDIRECT_URI);
      if (url.pathname !== '/callback') return void res.writeHead(404).end();
      const error = url.searchParams.get('error');
      const ok = !error && url.searchParams.get('state') === state;
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(ok ? 'Done. Go back to the terminal.' : `Spotify said: ${error ?? 'state mismatch'}`);
      server.close();
      if (ok) resolve(url.searchParams.get('code') ?? '');
      else reject(new Error(`Spotify sign-in failed: ${error ?? 'state mismatch'}`));
    });
    server.listen(8888, '127.0.0.1');
  });

  const authorize = new URL('https://accounts.spotify.com/authorize');
  authorize.search = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    state,
    // Shows the Agree page even if this account approved the app before
    show_dialog: 'true',
  }).toString();
  console.log(`\nOpening Spotify. If no browser opens, visit:\n${authorize.href}\n`);
  // Each system's own way to open a link; if it fails, the printed link is the way in
  const [opener, ...openerArgs] =
    process.platform === 'win32'
      ? ['rundll32', 'url.dll,FileProtocolHandler']
      : [process.platform === 'darwin' ? 'open' : 'xdg-open'];
  execFile(opener, [...openerArgs, authorize.href], () => {});

  const code = await codePromise;
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
    }),
  });
  const data = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!response.ok || !data.refresh_token || !data.access_token) {
    throw new Error(
      `Token exchange failed (${response.status}): ${data.error_description ?? data.error ?? 'no token'}`
    );
  }

  // Development mode needs a Premium owner, so say which account this is and its plan
  const me = (await (
    await fetch('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${data.access_token}` },
    })
  ).json()) as { display_name?: string; id?: string; product?: string };
  console.log(
    `Signed in as ${me.display_name ?? me.id ?? 'unknown'} (plan: ${me.product ?? 'unknown'})`
  );
  console.log(`\nSPOTIFY_REFRESH_TOKEN=${data.refresh_token}\n`);
  console.log('Put that value in Vercel (Production), then redeploy.');
}

run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
