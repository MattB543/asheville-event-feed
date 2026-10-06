import { ChevronRight } from 'lucide-react';
import IntentLink from '@/components/IntentLink';
import type { GroupEventRowData } from '@/lib/db/queries/groups';

interface GroupEventRowProps {
  event: GroupEventRowData;
  /** Past events: grey date badge instead of the brand one. */
  past?: boolean;
}

/** One event on a group page: date badge, title, "when · venue". Render inside a <ul>. */
export default function GroupEventRow({ event, past = false }: GroupEventRowProps) {
  const meta = event.venue ? `${event.whenLabel} · ${event.venue}` : event.whenLabel;

  return (
    <li>
      <IntentLink
        href={event.href}
        className="group flex items-center gap-3 sm:gap-4 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500"
      >
        <div
          aria-hidden="true"
          className={`flex flex-col items-center justify-center w-12 h-12 shrink-0 rounded-lg border ${
            past
              ? 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700'
              : 'bg-brand-50 dark:bg-brand-950/50 border-brand-100 dark:border-brand-800'
          }`}
        >
          <span
            className={`text-[10px] font-semibold uppercase tracking-wide leading-none ${
              past ? 'text-gray-500 dark:text-gray-400' : 'text-brand-700 dark:text-brand-300'
            }`}
          >
            {event.monthLabel}
          </span>
          <span
            className={`mt-1 text-lg font-bold leading-none ${
              past ? 'text-gray-600 dark:text-gray-300' : 'text-gray-900 dark:text-gray-100'
            }`}
          >
            {event.dayLabel}
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <p
            className={`text-sm font-medium line-clamp-2 group-hover:text-brand-600 dark:group-hover:text-brand-400 ${
              past ? 'text-gray-700 dark:text-gray-300' : 'text-gray-900 dark:text-gray-100'
            }`}
          >
            {event.title}
          </p>
          <p className="mt-0.5 text-xs sm:text-sm text-gray-500 dark:text-gray-400 truncate">
            {/* The badge is hidden from screen readers, so the date goes in here for them
                (past labels already carry the full date). */}
            {!past && (
              <span className="sr-only">
                {event.monthLabel} {event.dayLabel},{' '}
              </span>
            )}
            {meta}
          </p>
        </div>

        <ChevronRight
          size={16}
          aria-hidden="true"
          className="shrink-0 text-gray-300 dark:text-gray-600 group-hover:text-brand-500 dark:group-hover:text-brand-400 transition-colors"
        />
      </IntentLink>
    </li>
  );
}
