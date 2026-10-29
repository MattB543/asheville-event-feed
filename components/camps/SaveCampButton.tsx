'use client';

import { Star } from 'lucide-react';
import { toggleSavedCamp, useSavedCamps } from './savedCamps';

/** The save star: saved camps live in this browser and feed the saved-camps calendar. */
export default function SaveCampButton({
  campId,
  campName,
  withLabel = false,
}: {
  campId: string;
  campName: string;
  withLabel?: boolean;
}) {
  const { ids } = useSavedCamps();
  const saved = ids.includes(campId);
  return (
    <button
      type="button"
      aria-pressed={saved}
      aria-label={withLabel ? undefined : saved ? `Unsave ${campName}` : `Save ${campName}`}
      title={saved ? 'Saved in this browser' : 'Save this camp'}
      onClick={() => toggleSavedCamp(campId)}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg cursor-pointer ${
        withLabel
          ? 'min-h-9 px-3 py-1.5 text-sm font-medium border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900'
          : // A 40px tap target, pulled into the card's padding so the star sits where it did
            '-m-2 h-10 w-10 justify-center'
      } ${
        saved
          ? 'text-amber-600 dark:text-amber-400'
          : 'text-gray-500 dark:text-gray-400 hover:text-amber-600 dark:hover:text-amber-400'
      } transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500`}
    >
      <Star size={18} aria-hidden="true" fill={saved ? 'currentColor' : 'none'} />
      {withLabel && (saved ? 'Saved' : 'Save')}
    </button>
  );
}
