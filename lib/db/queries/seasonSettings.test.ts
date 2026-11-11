import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SEASONS } from '@/lib/seasons';

// The cache passes straight through, and the database answers however each test says
vi.mock('next/cache', () => ({ unstable_cache: (read: () => unknown) => read }));
const from = vi.fn();
vi.mock('@/lib/db', () => ({ db: { select: () => ({ from }) } }));

const christmasFromDec5 = {
  key: 'christmas',
  start: '12-05',
  end: '12-25',
  short: 'Christmas',
  banner: 'Christmas through {end}',
  enabled: true,
  color: '#1f5c3a',
  fade: true,
  icon: null,
};

describe('getSeasons, which every page waits on', () => {
  beforeEach(() => {
    // Each test gets the module fresh, without the last one's failed read
    vi.resetModules();
    vi.useFakeTimers();
    from.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('applies what admins saved over the defaults', async () => {
    from.mockResolvedValue([christmasFromDec5]);
    const { getSeasons } = await import('./seasonSettings');
    const seasons = await getSeasons();
    expect(seasons.find((s) => s.key === 'christmas')?.start).toBe('12-05');
    expect(seasons.find((s) => s.key === 'halloween')?.start).toBe('10-01');
  });

  it('gives the defaults after 3 seconds when the read never answers', async () => {
    from.mockReturnValue(new Promise(() => {}));
    const { getSeasons } = await import('./seasonSettings');
    const seasons = getSeasons();
    await vi.advanceTimersByTimeAsync(3000);
    await expect(seasons).resolves.toEqual(DEFAULT_SEASONS);
  });

  it('uses the defaults for a minute after a failed read, then asks again', async () => {
    from.mockRejectedValue(new Error('relation "season_settings" does not exist'));
    const { getSeasons } = await import('./seasonSettings');
    await expect(getSeasons()).resolves.toEqual(DEFAULT_SEASONS);
    await expect(getSeasons()).resolves.toEqual(DEFAULT_SEASONS);
    expect(from).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    from.mockResolvedValue([christmasFromDec5]);
    const seasons = await getSeasons();
    expect(seasons.find((s) => s.key === 'christmas')?.start).toBe('12-05');
  });
});
