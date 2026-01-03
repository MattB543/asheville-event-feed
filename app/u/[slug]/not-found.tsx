import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center px-4">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-4">Profile Not Found</h1>
        <p className="text-gray-600 dark:text-gray-400 mb-6">
          This curator profile doesn&apos;t exist or is set to private.
        </p>
        <Link
          href="/events"
          className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-brand-600 rounded-lg hover:bg-brand-700 transition-colors cursor-pointer"
        >
          Back to Events
        </Link>
      </div>
    </main>
  );
}
