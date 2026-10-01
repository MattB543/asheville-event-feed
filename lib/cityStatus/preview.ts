/**
 * Development-only water notices for previewing the badge and modal while the
 * city has nothing active. /api/city-status only consults this when
 * NODE_ENV === 'development'; open any page with `?cityPreview=boil` (boil +
 * an outage), `?cityPreview=outage` (three outages) or `?cityPreview=outage1`.
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
  // A shutdown window around now ("from 3 PM to 7 PM"), or the whole day near midnight
  const hour = Number(easternDate(now, { hour: 'numeric', hourCycle: 'h23' }));
  const clock = (offset: number) => easternDate(now + offset * HOUR_MS, { hour: 'numeric' });
  const window = hour >= 2 && hour <= 19 ? ` from ${clock(-1)} to ${clock(4)}` : '';
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
      `This is a City of Asheville Water Department notification for ongoing water distribution work occurring on ${today}.  This is also to notify customers that they may experience low to no water pressure and discolored water. \n\nThe affected areas are, Starnes Cove Rd, Holbrook Rd and surrounding areas. Water Resources crews are on site repairing a break in a large water main. Water service should be restored late tonight.\n\nCustomers are advised to wait until the water is clear before using it. If you experience either of these, customers are advised to wait 1-2 hours, then flush only the cold water lines for 10-15 minutes. If discolored water or air is still present, please call customer service at 828-251-1122.`
    ),
    repair: item(
      'repair',
      1,
      'Potential Low Pressure/No Water',
      `Potential Low Pressure/No Water/ Discolored Water @  [75 Rumbough Place]  on [${today}] @ [9 am]`,
      ` This is a City of Asheville Water Department notification for water distribution work occurring on [${today} 9 am]  This is also to notify customers that they may experience low to no water pressure and discolored water. \n\nThe affected areas are, [75 Rumbough Place]\n \nWhen the work is completed, there may be some discolored water or air in the lines.  Customers are advised to wait until the water is clear before using it.  If you experience either of these, customers are advised to wait 1-2 hours, then flush only the cold water lines for 10-15 minutes.  If discolored water or air is still present, please call customer service at 828-251-1122. \n\nThank you. \n\nNumber Affected: 350\nSent BY: DB`
    ),
    scheduled: item(
      'scheduled',
      26,
      'Scheduled Outage',
      `Scheduled Water Interruption 198 Lake Eden Road on ${today}`,
      `\nThis is a City of Asheville Water Notification of a Scheduled Water Interruption that will occur at 198 Lake Eden Road on ${weekday}, ${today}\n\n\n\n\nIn the East District, the affected areas are Lake Eden Road from Old US 70 to 198 Lake Eden Road. This shutdown is scheduled for ${weekday} ${today}${window}.\n\n\n\nSurrounding areas may experience no water to low pressure during this interruption.  When the work is completed, there may be some discolored water or air in the lines.\n\nFor more information please contact the Distribution Operations office at 259-5975 Monday through Friday from 8 AM to 5 PM.\n\nIssued By: BS\n\nNumber Affected 274`
    ),
  };
}

export function getWaterPreview(preview: WaterPreview, now: number): WaterStatus | null {
  const f = fixtures(now);
  const alerts =
    preview === 'boil'
      ? [f.boil, f.mainBreak]
      : preview === 'outage1'
        ? [f.repair]
        : [f.mainBreak, f.repair, f.scheduled];
  const status = getActiveWaterStatus(alerts, now);
  if (!status) return null;
  return {
    ...status,
    notices: status.notices.map((n) => ({ ...n, area: `[DEV PREVIEW] ${n.area ?? ''}` })),
  };
}
