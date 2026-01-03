import type { Metadata } from 'next';
import Header from '@/components/Header';
import CreateFeedWizard from '@/components/CreateFeedWizard';

export const metadata: Metadata = {
  title: 'Create Your Custom Feed | AVL GO',
  description:
    'Build a personalized event feed tailored to your interests, budget, and location preferences.',
};

export default function CreateFeedPage() {
  return (
    <main className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-950">
      <Header />

      {/* Wizard Content */}
      <div className="flex-1 max-w-2xl sm:max-w-3xl mx-auto w-full px-3 sm:px-6 lg:px-8 py-8">
        <CreateFeedWizard />
      </div>

      {/* Footer */}
      <footer className="bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
        <p>
          © {new Date().getFullYear()} Asheville Event Feed. Not affiliated with AVL Today,
          Eventbrite, Facebook Events, or Meetup.
        </p>
      </footer>
    </main>
  );
}
