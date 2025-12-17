import { Metadata } from "next";
import Link from "next/link";
import ThemeToggle from "@/components/ThemeToggle";
import UserMenu from "@/components/UserMenu";
import CreateFeedWizard from "@/components/CreateFeedWizard";

export const metadata: Metadata = {
  title: "Create Your Custom Feed | AVL GO",
  description: "Build a personalized event feed tailored to your interests, budget, and location preferences.",
};

export default function CreateFeedPage() {
  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* Header */}
      <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-3 sm:py-4">
          <div className="flex items-center justify-between">
            <Link href="/">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/avlgo_banner_logo_v2.svg"
                alt="AVL GO"
                className="h-[24px] sm:h-[36px] w-auto dark:brightness-0 dark:invert"
              />
            </Link>
            <div className="flex items-center gap-2">
              <ThemeToggle />
              <UserMenu />
            </div>
          </div>
        </div>
      </header>

      {/* Wizard Content */}
      <div className="max-w-2xl mx-auto px-3 sm:px-6 lg:px-8 py-8">
        <CreateFeedWizard />
      </div>

      {/* Footer */}
      <footer className="bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 mt-8 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
        <p>
          © {new Date().getFullYear()} Asheville Event Feed. Not affiliated with
          AVL Today, Eventbrite, Facebook Events, or Meetup.
        </p>
      </footer>
    </main>
  );
}
