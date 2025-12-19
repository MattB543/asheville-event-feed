export default function EventCardSkeleton() {
  return (
    <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 flex flex-col sm:flex-row gap-4 p-4 animate-pulse">
      {/* Image Placeholder */}
      <div className="w-full sm:w-48 h-32 flex-shrink-0 bg-gray-200 dark:bg-gray-700 rounded" />

      {/* Details Column */}
      <div className="flex-shrink-0 w-full sm:w-80 flex flex-col gap-2">
        {/* Title */}
        <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded w-3/4" />

        {/* Organizer */}
        <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/2" />

        {/* Date */}
        <div className="h-3 bg-gray-300 dark:bg-gray-600 rounded w-2/3" />

        {/* Location */}
        <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/2" />

        {/* Tags */}
        <div className="flex gap-1 mt-1">
          <div className="h-5 w-12 bg-gray-200 dark:bg-gray-700 rounded" />
          <div className="h-5 w-16 bg-gray-200 dark:bg-gray-700 rounded" />
          <div className="h-5 w-14 bg-gray-200 dark:bg-gray-700 rounded" />
        </div>
      </div>

      {/* Description Column */}
      <div className="flex-grow min-w-0 flex flex-col gap-2">
        <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-full" />
        <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-full" />
        <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-4/5" />
        <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-3/5" />
      </div>

      {/* Actions Column */}
      <div className="flex flex-row sm:flex-col gap-2 flex-shrink-0 items-end sm:items-center justify-start pt-1">
        <div className="w-8 h-8 bg-gray-200 dark:bg-gray-700 rounded" />
        <div className="w-8 h-8 bg-gray-200 dark:bg-gray-700 rounded" />
        <div className="w-8 h-8 bg-gray-200 dark:bg-gray-700 rounded" />
      </div>
    </div>
  );
}

export function FilterBarSkeleton() {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-2 mb-4 animate-pulse">
      {/* Search input placeholder */}
      <div className="w-full sm:flex-1 sm:min-w-0 h-10 bg-gray-200 dark:bg-gray-700 rounded-lg" />

      {/* Filter buttons */}
      <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap sm:flex-shrink-0">
        <div className="w-28 h-10 bg-gray-200 dark:bg-gray-700 rounded-lg" />
        <div className="w-28 h-10 bg-gray-200 dark:bg-gray-700 rounded-lg" />
        <div className="w-20 h-10 bg-gray-200 dark:bg-gray-700 rounded-lg" />
        <div className="w-32 h-10 bg-gray-200 dark:bg-gray-700 rounded-lg" />
      </div>
    </div>
  );
}

export function EventFeedSkeleton() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 min-h-[calc(100vh-200px)]">
      <FilterBarSkeleton />

      <div className="flex flex-col gap-6">
        {/* Today's events group */}
        <div className="flex flex-col gap-2">
          <div className="h-7 w-40 bg-gray-300 dark:bg-gray-600 rounded animate-pulse" />
          <div className="flex flex-col bg-white dark:bg-gray-900 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
            <EventCardSkeleton />
            <EventCardSkeleton />
            <EventCardSkeleton />
            <EventCardSkeleton />
          </div>
        </div>

        {/* Tomorrow's events group */}
        <div className="flex flex-col gap-2">
          <div className="h-7 w-48 bg-gray-300 dark:bg-gray-600 rounded animate-pulse" />
          <div className="flex flex-col bg-white dark:bg-gray-900 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
            <EventCardSkeleton />
            <EventCardSkeleton />
            <EventCardSkeleton />
          </div>
        </div>

        {/* Third day group */}
        <div className="flex flex-col gap-2">
          <div className="h-7 w-44 bg-gray-300 dark:bg-gray-600 rounded animate-pulse" />
          <div className="flex flex-col bg-white dark:bg-gray-900 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
            <EventCardSkeleton />
            <EventCardSkeleton />
          </div>
        </div>
      </div>
    </div>
  );
}
