/** A placeholder line or box. */
export function Bar({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-gray-200 dark:bg-gray-800 ${className}`} />;
}

/** A camp card's shape while the camps load. */
export default function CampCardSkeleton() {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3 flex flex-col gap-2">
      <Bar className="h-3 w-1/2" />
      <Bar className="h-5 w-3/4" />
      <Bar className="h-4 w-1/3" />
      <Bar className="mt-2 h-4 w-full" />
      <Bar className="h-4 w-5/6" />
      <Bar className="h-4 w-2/3" />
    </div>
  );
}
