/**
 * Development-only water notices for previewing the badge and modal while the
 * city has nothing active. /api/city-status only consults this when
 * NODE_ENV === 'development'; open any page with `?cityPreview=boil` (boil +
 * an outage), `?cityPreview=outage` (two outages) or `?cityPreview=outage1`.
 *
 * The fixtures are raw feed items (modeled on real notices) pushed through the
 * real active rule, so the preview also exercises parsing and grouping.
 */

import { getActiveWaterStatus, type RawWaterAlert } from './water';
import type { WaterStatus } from './types';

export type WaterPreview = 'boil' | 'outage' | 'outage1';

export function isWaterPreview(value: string | null): value is WaterPreview {
  return value === 'boil' || value === 'outage' || value === 'outage1';
}

const HOUR_MS = 60 * 60 * 1000;

function easternDate(now: number, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', ...options }).format(
    new Date(now)
  );
}

function fixtures(now: number): Record<string, RawWaterAlert> {
  const today = easternDate(now, { month: 'long', day: 'numeric', year: 'numeric' });
  const weekday = easternDate(now, { weekday: 'long' });
  const item = (id: string, hoursAgo: number, category: string, title: string, text: string) => ({
    notificationId: `preview-${id}`,
    startDateEpoch: now - hoursAgo * HOUR_MS,
    categories: [category],
    title,
    textMessage: text,
  });

  return {
    boil: item(
      'boil',
      3,
      'Boil Water Advisory',
      `Boil Water Advisory [Haw Creek and surrounding areas] [${today}]`,
      `This is a City of Asheville Water Resources notification of a Boil Water Advisory issued on ${weekday}, ${today} following a loss of pressure from a water main break.\n\n\nThe affected areas are, New Haw Creek Road, Old Haw Creek Road and surrounding areas.\n\n\nAs a precaution, customers in the affected area should bring water to a rolling boil for at least one minute before drinking, cooking, making ice or brushing teeth. This advisory remains in effect until the City of Asheville lifts it.\n\nFor questions please call customer service at 828-251-1122.`
    ),
    mainBreak: item(
      'main-break',
      2,
      'Potential Low Pressure/No Water',
      `Potential Low Pressure/No Water/ Discolored Water @ Starnes Cove Rd, Holbrook Rd and surrounding areas on ${today}`,
      `This is a City of Asheville Water Department notification for ongoing water distribution work occurring on ${today}.  This is also to notify customers that they may experience low to no water pressure and discolored water. \n\nThe affected areas are, Starnes Cove Rd, Holbrook Rd and surrounding areas. Water Resources crews are on site repairing a break in a large water main. Water service should be restored late tonight.\n\nCustomers are advised to wait until the water is clear before using it. If you experience either of these, customers are advised to wait 1-2 hours, then flush only the cold water lines for 10-15 minutes. If discolored water or air is still present, please call customer service at 828-251-1122.\n\nNumber Affected: 1064\nSent BY: DB`
    ),
    eastBreak: item(
      'east-break',
      1,
      'Potential Low Pressure/No Water',
      `Potential Low Pressure/No Water/ Discolored Water @ Sweeten Creek Rd, Caribou Rd and surrounding areas on ${today}`,
      `This is a City of Asheville Water Department notification for ongoing water distribution work occurring on ${today}.  This is also to notify customers that they may experience low to no water pressure and discolored water. \n\nThe affected areas are, Sweeten Creek Rd, Caribou Rd and surrounding areas. Water Resources crews are on site repairing a break in a water main.\n\nCustomers are advised to wait until the water is clear before using it. If discolored water or air is still present, please call customer service at 828-251-1122.\n\nNumber Affected: 1412\nSent BY: DB`
    ),
  };
}

export function getWaterPreview(preview: WaterPreview, now: number): WaterStatus | null {
  const f = fixtures(now);
  const alerts =
    preview === 'boil'
      ? [f.boil, f.mainBreak]
      : preview === 'outage1'
        ? [f.mainBreak]
        : [f.mainBreak, f.eastBreak];
  const status = getActiveWaterStatus(alerts, now);
  if (!status) return null;
  return {
    ...status,
    notices: status.notices.map((n) => ({ ...n, area: `[DEV PREVIEW] ${n.area ?? ''}` })),
  };
}
