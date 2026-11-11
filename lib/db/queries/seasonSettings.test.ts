import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SEASONS } from '@/lib/seasons';

// The cache passes straight through, and the database answers however each test says
const cached = vi.fn((read: () => unknown) => read);
vi.mock('next/cache', () => ({ unstable_cache: cached }));
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
    cached.mockClear();
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

  it('times the read out inside the cache, which Next waits on before finishing a page', async () => {
    from.mockReturnValue(new Promise(() => {}));
    const { getSeasons } = await import('./seasonSettings');
    void getSeasons();
    const read = cached.mock.calls[0][0]() as Promise<unknown>;
    const settled = expect(read).rejects.toThrow('No answer in 3000ms');
    await vi.advanceTimersByTimeAsync(3000);
    await settled;
  });

  it('sends one read when many pages ask at once', async () => {
    from.mockResolvedValue([christmasFromDec5]);
    const { getSeasons } = await import('./seasonSettings');
    const all = await Promise.all([getSeasons(), getSeasons(), getSeasons()]);
    expect(from).toHaveBeenCalledTimes(1);
    expect(all.map((s) => s.find((x) => x.key === 'christmas')?.start)).toEqual([
      '12-05',
      '12-05',
      '12-05',
    ]);
  });

  it('uses the defaults for a minute after a failed read, then asks again', async () => {
    from.mockRejectedValue(new Error('relation "season_settings" does not exist'));
    const { getSeasons } = await import('./seasonSettings');
    await expect(getSeasons()).resolves.toEqual(DEFAULT_SEASONS);
    await expect(getSeasons()).resolves.toEqual(DEFAULT_SEASONS);
    expect(from).toHaveBeenCalledTimes(1);
    // The cache is still asked both times: that call is what gives a page its hourly refresh
    expect(cached).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(60_000);
    from.mockResolvedValue([christmasFromDec5]);
    const seasons = await getSeasons();
    expect(seasons.find((s) => s.key === 'christmas')?.start).toBe('12-05');
  });
});
