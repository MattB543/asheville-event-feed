import { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import ThemeToggle from "@/components/ThemeToggle";
import SubmitEventButton from "@/components/SubmitEventButton";
import UserMenu from "@/components/UserMenu";
import HomeFilterButton from "@/components/HomeFilterButton";
import PublicCuratorCard from "@/components/PublicCuratorCard";
import { getPublicCuratorProfiles } from "@/lib/supabase/curatorProfile";
import {
  Users,
  Music,
  Trophy,
  Gamepad2,
  Utensils,
  Mountain,
  Gift,
  Calendar,
  Sparkles,
} from "lucide-react";

export const metadata: Metadata = {
  title: "AVL GO - Asheville Events",
  description:
    "Discover Asheville events aggregated from 10+ sources. Find family events, live music, sports, trivia, and more.",
};

export const revalidate = 3600; // Revalidate every hour

const FILTER_BUTTONS = [
  { label: "Family", href: "/events?tagsInclude=Family", icon: Users },
  {
    label: "Live Music",
    href: "/events?tagsInclude=Live%20Music",
    icon: Music,
  },
  { label: "Sports", href: "/events?tagsInclude=Sports", icon: Trophy },
  {
    label: "Trivia & Games",
    href: "/events?tagsInclude=Trivia",
    icon: Gamepad2,
  },
  { label: "Food & Drink", href: "/events?tagsInclude=Dining", icon: Utensils },
  { label: "Outdoors", href: "/events?tagsInclude=Outdoors", icon: Mountain },
  { label: "Free Events", href: "/events?priceFilter=free", icon: Gift },
  { label: "This Weekend", href: "/events?dateFilter=weekend", icon: Calendar },
];

export default async function HomePage() {
  let curators: Awaited<ReturnType<typeof getPublicCuratorProfiles>> = [];

  try {
    curators = await getPublicCuratorProfiles(6);
  } catch (error) {
    console.error("[Home] Failed to fetch curators:", error);
  }

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* Header */}
      <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-3 sm:py-4">
          {/* Mobile: two-row layout */}
          <div className="flex flex-col gap-2 sm:hidden">
            <div className="flex items-center justify-between">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/avlgo_banner_logo_v2.svg"
                alt="AVL GO"
                className="h-[24px] w-auto dark:brightness-0 dark:invert"
              />
              <div className="flex items-center gap-2">
                <SubmitEventButton />
                <ThemeToggle />
                <UserMenu />
              </div>
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              All AVL events aggregated, by{" "}
              <a
                href="https://mattbrooks.xyz"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-gray-700 dark:hover:text-gray-300"
              >
                mattbrooks.xyz
              </a>
            </div>
          </div>
          {/* Desktop: horizontal layout */}
          <div className="hidden sm:flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/avlgo_banner_logo_v2.svg"
                alt="AVL GO"
                className="h-[36px] w-auto dark:brightness-0 dark:invert"
              />
              <div className="text-sm text-gray-500 dark:text-gray-400">
                All AVL events aggregated, by{" "}
                <a
                  href="https://mattbrooks.xyz"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-gray-700 dark:hover:text-gray-300"
                >
                  mattbrooks.xyz
                </a>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <SubmitEventButton />
              <ThemeToggle />
              <UserMenu />
            </div>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-12 sm:py-16 text-center">
          <div className="mb-8 flex justify-center">
            <Image
              src="/asheville-default.jpg"
              alt="Asheville"
              width={400}
              height={200}
              className="rounded-lg"
              priority
            />
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white mb-4">
            Discover Asheville Events
          </h1>
          <p className="text-lg text-gray-600 dark:text-gray-400 mb-8 max-w-lg mx-auto">
            All local events in one place so you can find the events made for
            you.
          </p>
          <Link
            href="/create"
            className="inline-flex items-center gap-2 bg-brand-600 hover:bg-brand-700 text-white font-medium rounded-lg px-6 py-3 transition-colors cursor-pointer"
          >
            <Sparkles className="w-5 h-5" />
            Create your custom feed
          </Link>
        </div>
      </section>

      {/* Quick Filters Section */}
      <section className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-10">
        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-6">
          Jump to...
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {FILTER_BUTTONS.map((button) => (
            <HomeFilterButton
              key={button.label}
              label={button.label}
              href={button.href}
              icon={button.icon}
            />
          ))}
        </div>
      </section>

      {/* Public Curators Section */}
      {curators.length > 0 && (
        <section className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-10 border-t border-gray-200 dark:border-gray-800">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-6">
            Curated feeds by local experts...
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {curators.map((curator) => (
              <PublicCuratorCard
                key={curator.userId}
                slug={curator.slug}
                displayName={curator.displayName}
                bio={curator.bio}
                avatarUrl={curator.avatarUrl}
                showProfilePicture={curator.showProfilePicture}
                curationCount={curator.curationCount}
              />
            ))}
          </div>
        </section>
      )}

      {/* Footer */}
      <footer className="bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 mt-8 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
        <p className="mb-2">
          Built by Matt Brooks at Brooks Solutions, LLC. Learn more at{" "}
          <a
            href="https://mattbrooks.xyz"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-gray-700 dark:hover:text-gray-300"
          >
            mattbrooks.xyz
          </a>
        </p>
        <p>
          © {new Date().getFullYear()} Asheville Event Feed. Not affiliated with
          AVL Today, Eventbrite, Facebook Events, or Meetup.
        </p>
      </footer>
    </main>
  );
}
