import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';

const notify = vi.fn(() => Promise.resolve(true));
vi.mock('@/lib/notifications/slack', () => ({ sendSpotifyLoginNotification: notify }));

const { searchTracks } = await import('./spotify');

describe('a refused Spotify login', () => {
  beforeEach(async () => {
    await db.execute(sql`TRUNCATE cron_job_runs`);
    notify.mockClear();
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          Response.json(
            { error: 'invalid_grant', error_description: 'Refresh token expired' },
            { status: 400 }
          )
        )
      )
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('posts to Slack once a day, however many lookups fail', async () => {
    await expect(searchTracks('Alex Bazemore')).rejects.toThrow('invalid_grant');
    await expect(searchTracks('Alex Bazemore')).rejects.toThrow('invalid_grant');
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith('400 invalid_grant Refresh token expired');

    // A day later it is worth saying again
    await db.execute(sql`UPDATE cron_job_runs SET started_at = now() - interval '25 hours'`);
    await expect(searchTracks('Alex Bazemore')).rejects.toThrow('invalid_grant');
    expect(notify).toHaveBeenCalledTimes(2);
  });
});
