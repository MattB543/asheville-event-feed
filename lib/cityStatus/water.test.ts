import { describe, expect, it } from 'vitest';
import { getActiveWaterStatus, type RawWaterAlert } from './water';

const NOW = Date.parse('2026-10-20T16:00:00Z');
const HOUR = 60 * 60 * 1000;

const alert = (over: Partial<RawWaterAlert>): RawWaterAlert => ({
  notificationId: over.title ?? 'id',
  startDateEpoch: NOW - HOUR,
  title: 'Water Outage - 12 Starnes Cove Rd',
  textMessage: 'Crews are repairing a water main.',
  categories: ['Water Outage'],
  ...over,
});

describe('water badge', () => {
  it('shows a boil-water advisory', () => {
    const status = getActiveWaterStatus(
      [alert({ title: 'Boil Water Advisory - Haw Creek', categories: ['Boil Water Advisory'] })],
      NOW
    );
    expect(status?.notices.map((n) => n.kind)).toEqual(['boil']);
  });

  it('treats the boil category alone as an outage, not an advisory', () => {
    const status = getActiveWaterStatus(
      [alert({ title: 'Water Outage - 5 Wake Robin Way', categories: ['Boil Water Advisory'] })],
      NOW
    );
    expect(status).toBeNull();
  });

  it('shows an unplanned outage only when 1,000+ people are affected', () => {
    const small = alert({ textMessage: 'Number Affected: 274' });
    const big = alert({
      title: 'Water Outage - Starnes Cove Rd',
      textMessage: 'Number Affected: 1,064',
    });
    expect(getActiveWaterStatus([small], NOW)).toBeNull();
    expect(getActiveWaterStatus([big], NOW)?.notices).toHaveLength(1);
  });

  it('never shows scheduled work, even when large', () => {
    const scheduled = alert({
      title: 'Scheduled Water Interruption - Starnes Cove Rd',
      categories: ['Scheduled Outage'],
      textMessage: 'Number Affected: 5,000',
    });
    expect(getActiveWaterStatus([scheduled], NOW)).toBeNull();
  });

  it('drops an outage after 24 hours and an advisory after 14 days', () => {
    const oldOutage = alert({
      textMessage: 'Number Affected: 2,000',
      startDateEpoch: NOW - 25 * HOUR,
    });
    const oldBoil = alert({
      title: 'Boil Water Advisory - Haw Creek',
      startDateEpoch: NOW - 15 * 24 * HOUR,
    });
    expect(getActiveWaterStatus([oldOutage, oldBoil], NOW)).toBeNull();
  });

  it('clears an advisory when its lift is posted for the same place', () => {
    const boil = alert({
      title: 'Boil Water Advisory - Haw Creek',
      startDateEpoch: NOW - 5 * HOUR,
    });
    const lift = alert({
      title: 'Lift of Boil Water Advisory - Haw Creek',
      startDateEpoch: NOW - HOUR,
    });
    expect(getActiveWaterStatus([boil, lift], NOW)).toBeNull();
  });
});
