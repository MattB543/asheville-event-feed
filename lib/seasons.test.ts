import { describe, expect, it } from 'vitest';
import { SEASONS, checkSeasonSettings, currentSeason, withSettings } from './seasons';

const form = {
  start: '12-01',
  end: '12-31',
  short: 'Christmas',
  banner: 'Christmas through {end}',
  enabled: true,
  color: '#b45309',
  fade: false,
  icon: null,
};

describe('checkSeasonSettings', () => {
  it('accepts every-year and one-year dates', () => {
    expect(checkSeasonSettings(form).ok).toBe(true);
    expect(checkSeasonSettings({ ...form, start: '02-29', end: '03-01' }).ok).toBe(true);
    expect(checkSeasonSettings({ ...form, start: '2026-12-01', end: '2026-12-31' }).ok).toBe(true);
    // An every-year season can run across Jan 1
    expect(checkSeasonSettings({ ...form, start: '12-20', end: '01-05' }).ok).toBe(true);
  });

  it('refuses dates that are not real or do not pair up', () => {
    for (const dates of [
      { start: '02-30', end: '03-01' },
      { start: '13-01', end: '12-31' },
      { start: '12-1', end: '12-31' },
      { start: '2026-12-01', end: '12-31' },
      { start: '2026-12-31', end: '2026-12-01' },
    ]) {
      expect(checkSeasonSettings({ ...form, ...dates }).ok).toBe(false);
    }
  });

  it('refuses a colour that is not #rrggbb', () => {
    expect(checkSeasonSettings({ ...form, color: '#b45309' }).ok).toBe(true);
    expect(checkSeasonSettings({ ...form, color: 'red' }).ok).toBe(false);
  });

  it('takes one emoji as the icon, and nothing else', () => {
    expect(checkSeasonSettings({ ...form, icon: '🎄' }).ok).toBe(true);
    expect(checkSeasonSettings({ ...form, icon: '🎄🎄' }).ok).toBe(false);
    expect(checkSeasonSettings({ ...form, icon: 'x' }).ok).toBe(false);
  });

  it('refuses an empty or too-long banner', () => {
    expect(checkSeasonSettings({ ...form, banner: '  ' }).ok).toBe(false);
    expect(checkSeasonSettings({ ...form, short: 'x'.repeat(61) }).ok).toBe(false);
  });
});

describe('withSettings', () => {
  it('moves a season to the dates an admin saved', () => {
    const seasons = withSettings(new Map([['thanksgiving', { ...form, start: '11-20' }]]));
    expect(currentSeason(seasons, '2026-11-15')?.key).not.toBe('thanksgiving');
    expect(currentSeason(seasons, '2026-11-20')?.key).toBe('thanksgiving');
    expect(seasons).toHaveLength(SEASONS.length);
  });

  it('shows nothing for a season that is turned off', () => {
    const off = { ...form, start: '11-09', end: '11-30', enabled: false };
    expect(currentSeason(withSettings(new Map([['thanksgiving', off]])), '2026-11-20')).toBeNull();
  });
});
