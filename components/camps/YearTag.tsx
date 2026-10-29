import { TARGET_SEASON, type RegistrationNote } from '@/lib/camps/display';

/** "2026" beside a value from last summer, when the camp hasn't posted 2027 yet (D12). */
export function YearTag({ year }: { year: number }) {
  if (year >= TARGET_SEASON) return null;
  return (
    <span
      title={`From summer ${year}; ${TARGET_SEASON} not posted yet`}
      className="ml-1.5 inline-block rounded px-1 text-[11px] font-medium leading-4 bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
    >
      {year}
    </span>
  );
}

/** A registration date the AI wasn't sure of and Matt hasn't confirmed yet. */
export function UnconfirmedTag() {
  return (
    <span
      title="Read from the camp's site by AI and not confirmed yet: check with the camp"
      className="ml-1.5 inline-block rounded px-1 text-[11px] font-medium leading-4 bg-amber-100 text-amber-900 dark:bg-amber-900/60 dark:text-amber-100"
    >
      unconfirmed
    </span>
  );
}

/** The registration line's smaller lines, each date with its own "unconfirmed" label. */
export function RegistrationDetails({
  details,
  className,
}: {
  details: RegistrationNote[];
  className: string;
}) {
  if (details.length === 0) return null;
  return (
    <p className={className}>
      {details.map((note, index) => (
        <span key={index}>
          {index > 0 && ' · '}
          {note.text}
          {note.unconfirmed && <UnconfirmedTag />}
        </span>
      ))}
    </p>
  );
}
