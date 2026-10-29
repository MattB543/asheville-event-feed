'use client';

import SaveCampButton from './SaveCampButton';
import SavedCalendar from './SavedCalendar';
import { useSavedCamps } from './savedCamps';

/**
 * On a camp page with no registration date to add yet: save the camp, then subscribe to the
 * saved-camps calendar, which gets the date once the camp posts it (01 §4.4).
 */
export default function CampReminderOffer({
  campId,
  campName,
}: {
  campId: string;
  campName: string;
}) {
  const { ids } = useSavedCamps();
  const saved = ids.includes(campId);
  return (
    <div className="space-y-2 rounded-lg bg-gray-50 dark:bg-gray-800/60 p-3 text-sm text-gray-700 dark:text-gray-300">
      <p>
        {saved
          ? 'Saved. Put your saved camps in your calendar and this camp’s registration date shows up there once it’s posted.'
          : 'Get the date when it’s posted: save this camp, then put your saved camps in your calendar.'}
      </p>
      {saved ? <SavedCalendar /> : <SaveCampButton campId={campId} campName={campName} withLabel />}
    </div>
  );
}
