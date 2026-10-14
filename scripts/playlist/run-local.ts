import '../../lib/config/env';
import { isSpotifyEnabled } from '../../lib/config/env';
import { isClassifierEnabled } from '../../lib/playlist/match';
import { runPlaylist } from '../../lib/playlist/run';

// Preview this week's playlist against DATABASE_URL. Matches are saved either
// way; only --apply replaces the Spotify playlist and records the picks.
async function main() {
  const apply = process.argv.includes('--apply');
  if (!isSpotifyEnabled() || !isClassifierEnabled()) {
    throw new Error(
      'Needs SPOTIFY_CLIENT_ID/SECRET/REFRESH_TOKEN/PLAYLIST_ID and ANTHROPIC_API_KEY or Azure AI in .env'
    );
  }

  const result = await runPlaylist({ dryRun: !apply });
  const date = (d: Date) =>
    d.toLocaleDateString('en-US', {
      timeZone: 'America/New_York',
      weekday: 'short',
      month: 'numeric',
      day: 'numeric',
    });

  console.log(
    `${result.musicEvents} music events in the window, top ${result.candidates} considered, ` +
      `${result.spotifySearches} Spotify searches${result.classifierFailed ? ', CLASSIFIER FAILED' : ''}\n`
  );
  for (const s of result.shows) {
    console.log(
      `  ${date(s.event.startDate).padEnd(9)} ${s.spotifyArtist} - "${s.trackName}"${s.soldOut ? '  [SOLD OUT]' : ''}`
    );
  }
  console.log(`\nSkipped (${result.skipped.length}):`);
  for (const s of result.skipped) console.log(`  ${s.title}\n      ${s.note}`);
  console.log(
    apply
      ? '\nPlaylist replaced and picks saved.'
      : '\nDry run: playlist untouched. Pass --apply to update it.'
  );
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
