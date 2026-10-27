import Image from 'next/image';
import ResponseBadge from '@/components/plan/ResponseBadge';
import { CANDIDATES, type Candidate, type Office } from '@/lib/plan/candidates';

const OFFICE_HEADINGS: Record<Office, string> = {
  emergency: 'Emergency management',
  mayor: 'Mayor',
  council: 'City Council',
  commission: 'County Commission',
};

/** The groups on the page, in order; County Commission is left off for now */
const SHOWN_OFFICES: Office[] = ['mayor', 'council', 'emergency'];

function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  return (
    (parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '')
  ).toUpperCase();
}

function CandidateCard({ candidate }: { candidate: Candidate }) {
  // Only what the office heading doesn't already say: "District 1", not "County Commission, District 1"
  const heading = OFFICE_HEADINGS[candidate.office];
  const seat =
    candidate.seat === heading ? null : candidate.seat.replace(`${heading}, `, '') || null;
  // The officials' long job titles are cramped beside the photo in a half-width phone card,
  // so there the photo sits beside the name alone and the title and badge run full width below
  const stacked = candidate.office === 'emergency';
  return (
    <li
      // Stacked, a card stretched to its taller neighbor packs its rows to the top instead of spreading them
      className={`grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 ${stacked ? 'content-start sm:content-normal' : ''} rounded-lg border border-gray-200 bg-white p-2 sm:gap-x-3 sm:p-2.5 dark:border-gray-800 dark:bg-gray-900`}
    >
      {candidate.photo ? (
        <Image
          src={candidate.photo}
          alt=""
          width={56}
          height={56}
          className={`h-10 w-10 rounded-full object-cover sm:h-14 sm:w-14 ${stacked ? 'sm:row-span-2' : 'row-span-2'}`}
        />
      ) : (
        <span
          aria-hidden="true"
          className={`flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-sm sm:h-14 sm:w-14 sm:text-base font-semibold text-gray-500 dark:bg-gray-800 dark:text-gray-400 ${stacked ? 'sm:row-span-2' : 'row-span-2'}`}
        >
          {initials(candidate.name)}
        </span>
      )}
      <p
        className={`text-[13px] font-semibold leading-snug text-gray-900 sm:text-sm dark:text-gray-100 ${stacked ? 'sm:self-end' : 'self-end'}`}
      >
        {candidate.name}
      </p>
      <div
        className={`min-w-0 ${stacked ? 'col-span-2 mt-1.5 sm:col-span-1 sm:col-start-2 sm:mt-0 sm:self-start' : 'col-start-2 self-start'}`}
      >
        {seat && (
          <p className="text-[11px] leading-snug text-gray-500 sm:text-xs dark:text-gray-400">
            {seat}
          </p>
        )}
        {candidate.response ? (
          <ResponseBadge name={candidate.name} response={candidate.response} />
        ) : (
          <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-red-50 px-1.5 py-0.5 text-[11px] whitespace-nowrap sm:px-2 sm:text-xs font-medium text-red-700 dark:bg-red-950/40 dark:text-red-400">
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
            No answer
          </p>
        )}
      </div>
    </li>
  );
}

/** The leaders the letter asks, grouped by office, with where they stand */
export default function CandidateGrid() {
  const offices = SHOWN_OFFICES.filter((office) => CANDIDATES.some((c) => c.office === office));
  return (
    <div className="space-y-5">
      {offices.map((office) => (
        <div key={office}>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {OFFICE_HEADINGS[office]}
          </h3>
          {/* The officials' long job titles get half-width cards; candidates fit three across */}
          <ul
            className={`mt-2 grid grid-cols-2 gap-2 ${office === 'emergency' ? '' : 'md:grid-cols-3'}`}
          >
            {CANDIDATES.filter((c) => c.office === office).map((candidate) => (
              <CandidateCard key={candidate.slug} candidate={candidate} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
