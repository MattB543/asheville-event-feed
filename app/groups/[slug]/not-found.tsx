import Link from 'next/link';
import { ArrowLeft, Users } from 'lucide-react';
import Header from '@/components/Header';

export default function GroupNotFound() {
  return (
    <main className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-950">
      <Header activeTab="groups" />

      <div className="flex-1 flex items-center justify-center px-4 py-16">
        <div className="text-center max-w-md">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gray-100 dark:bg-gray-800 rounded-full mb-6">
            <Users size={32} aria-hidden="true" className="text-gray-400 dark:text-gray-500" />
          </div>

          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-gray-100 mb-4">
            Group not found
          </h1>

          <p className="text-gray-600 dark:text-gray-400 mb-8">
            This group isn&apos;t in the directory, or the link is out of date.
          </p>

          <Link
            href="/groups"
            className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-brand-600 hover:bg-brand-700 text-white rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-50 dark:focus-visible:ring-offset-gray-950"
          >
            <ArrowLeft size={18} aria-hidden="true" />
            All groups
          </Link>
        </div>
      </div>
    </main>
  );
}
