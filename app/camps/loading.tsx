import Header from '@/components/Header';

/** A placeholder line or box. */
function Bar({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-gray-200 dark:bg-gray-800 ${className}`} />;
}

/**
 * The camps pages' shape while they load (the root loading.tsx is the event feed's): a title,
 * the filters, then a few camp cards. Serves /camps/[slug] too.
 */
export default function CampsLoading() {
  return (
    <main className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-950">
      <Header activeTab="camps" />

      <div className="flex-grow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 pb-10" aria-busy="true">
          <Bar className="h-6 sm:h-8 w-72 max-w-full" />
          <Bar className="mt-3 h-4 w-96 max-w-full" />
          <Bar className="mt-4 h-10 w-full rounded-lg" />
          <Bar className="mt-6 h-40 w-full rounded-xl" />

          <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((card) => (
              <div
                key={card}
                className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3 flex flex-col gap-2"
              >
                <Bar className="h-3 w-1/2" />
                <Bar className="h-5 w-3/4" />
                <Bar className="h-4 w-1/3" />
                <Bar className="mt-2 h-4 w-full" />
                <Bar className="h-4 w-5/6" />
                <Bar className="h-4 w-2/3" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
