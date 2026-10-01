import Header from '@/components/Header';

/** A placeholder line or box. */
function Bar({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-gray-200 dark:bg-gray-800 ${className}`} />;
}

/** The news page's shape while it loads: the title, then a day of cards and rows. */
export default function NewsLoading() {
  return (
    <main className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-950">
      <Header activeTab="news" />

      <div className="flex-grow">
        <div className="max-w-7xl mx-auto px-0 sm:px-6 lg:px-8 pt-6 pb-4">
          <div className="max-w-3xl mx-auto" aria-busy="true">
            <div className="px-3 sm:px-0">
              <h1 className="text-lg sm:text-2xl font-bold text-gray-900 dark:text-gray-100">
                Asheville news
              </h1>
              <Bar className="mt-2 h-4 w-80 max-w-full" />
              <Bar className="mt-4 h-9 sm:h-10 w-full rounded-lg" />
            </div>

            <div className="mt-6 bg-white dark:bg-gray-900 sm:border border-y border-gray-200 dark:border-gray-800 sm:rounded-lg sm:shadow-sm overflow-hidden">
              <div className="px-3 sm:px-5 pt-3 pb-2 border-b border-gray-200 dark:border-gray-800">
                <Bar className="h-7 w-24" />
              </div>

              {[0, 1].map((card) => (
                <div
                  key={card}
                  className="px-3 py-5 sm:px-5 border-b border-gray-200 dark:border-gray-800 flex flex-col gap-3 sm:flex-row-reverse sm:items-start sm:gap-5"
                >
                  <Bar className="aspect-video sm:w-52 sm:shrink-0 rounded-lg" />
                  <div className="flex-1 flex flex-col gap-2">
                    <Bar className="h-6 w-4/5" />
                    <Bar className="h-4 w-full" />
                    <Bar className="h-4 w-full" />
                    <Bar className="h-4 w-2/3" />
                    <Bar className="mt-2 h-7 w-40 rounded-md" />
                  </div>
                </div>
              ))}

              <div className="px-3 sm:px-5 py-4 flex flex-col gap-4">
                {['w-3/4', 'w-2/3', 'w-5/6', 'w-1/2'].map((width) => (
                  <Bar key={width} className={`h-4 ${width}`} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
