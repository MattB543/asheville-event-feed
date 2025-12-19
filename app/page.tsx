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
  Database,
  ShieldOff,
  Code,
  Upload,
  SlidersHorizontal,
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
    <main className="min-h-screen bg-[var(--background)] bg-texture">
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
            <div className="text-xs text-gray-500/70 dark:text-gray-400/70">
              <a
                href="https://github.com/MattB543/asheville-event-feed"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-gray-700 dark:hover:text-gray-300"
              >
                Open-sourced
              </a>{" "}
              by{" "}
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
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/avlgo_banner_logo_v2.svg"
              alt="AVL GO"
              className="h-[36px] w-auto dark:brightness-0 dark:invert"
            />
            <div className="flex items-center gap-4">
              <div className="text-sm text-gray-500/70 dark:text-gray-400/70">
                <a
                  href="https://github.com/MattB543/asheville-event-feed"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-gray-700 dark:hover:text-gray-300"
                >
                  Open-sourced
                </a>{" "}
                by{" "}
                <a
                  href="https://mattbrooks.xyz"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-gray-700 dark:hover:text-gray-300"
                >
                  mattbrooks.xyz
                </a>
              </div>
              <SubmitEventButton />
              <ThemeToggle />
              <UserMenu />
            </div>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative">
        {/* Background image with gradient overlay - extends into next section */}
        <div className="absolute inset-0 -bottom-48 overflow-hidden">
          <Image
            src="/asheville_bg.jpg"
            alt="Asheville Mountains"
            fill
            className="object-cover object-top opacity-40 dark:opacity-30"
            priority
          />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent via-70% to-[var(--background)]" />
        </div>

        {/* Content */}
        <div className="relative max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 pt-20 sm:pt-28 pb-16 sm:pb-20 text-center">
          <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl font-bold text-gray-900 dark:text-white mb-4 tracking-tight -mt-5">
            Every Asheville event.
            <br />
            <span className="text-brand-600 dark:text-brand-400">
              Zero noise.
            </span>
          </h1>
          <p className="text-lg sm:text-xl font-medium text-gray-800 dark:text-gray-200 mb-10 max-w-2xl mx-auto leading-relaxed">
            Dozens of sources. No ads or sponsorships. No broken incentives.
            <br />
            Just awesome events.
          </p>
          <Link
            href="/create"
            className="btn-shimmer inline-flex items-center gap-2.5 bg-brand-600 hover:bg-brand-700 text-white font-semibold rounded-full px-8 py-4 transition-colors cursor-pointer shadow-lg shadow-brand-600/25 hover:shadow-brand-600/40"
          >
            <Sparkles className="w-5 h-5" />
            Create your custom feed
          </Link>
        </div>
      </section>

      {/* Why AVL GO Section */}
      <section className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-16">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="card-lift animate-fade-up delay-1 flex items-center gap-4 p-5 bg-white dark:bg-gray-900 rounded-xl border border-gray-200/80 dark:border-gray-800/80">
            <div className="flex-1">
              <h3 className="font-semibold text-gray-900 dark:text-white mb-1">
                All in one place
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Every AVL event source in one clean feed.
              </p>
            </div>
            <div className="icon-circle">
              <Database className="w-6 h-6 text-brand-600" />
            </div>
          </div>
          <div className="card-lift animate-fade-up delay-2 flex items-center gap-4 p-5 bg-white dark:bg-gray-900 rounded-xl border border-gray-200/80 dark:border-gray-800/80">
            <div className="flex-1">
              <h3 className="font-semibold text-gray-900 dark:text-white mb-1">
                No ads, ever
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                No sponsors. No promotions. Free forever.
              </p>
            </div>
            <div className="icon-circle">
              <ShieldOff className="w-6 h-6 text-brand-600" />
            </div>
          </div>
          <div className="card-lift animate-fade-up delay-3 flex items-center gap-4 p-5 bg-white dark:bg-gray-900 rounded-xl border border-gray-200/80 dark:border-gray-800/80">
            <div className="flex-1">
              <h3 className="font-semibold text-gray-900 dark:text-white mb-1">
                Open source, open data
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                All data available via{" "}
                <a
                  href="https://avlgo.com/api/export/json"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-gray-700 dark:hover:text-gray-300"
                >
                  JSON API
                </a>
                .
              </p>
            </div>
            <div className="icon-circle">
              <Code className="w-6 h-6 text-brand-600" />
            </div>
          </div>
          <div className="card-lift animate-fade-up delay-4 flex items-center gap-4 p-5 bg-white dark:bg-gray-900 rounded-xl border border-gray-200/80 dark:border-gray-800/80">
            <div className="flex-1">
              <h3 className="font-semibold text-gray-900 dark:text-white mb-1">
                AI-enhanced
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Auto-tags, smart search, similar events.
              </p>
            </div>
            <div className="icon-circle">
              <Sparkles className="w-6 h-6 text-brand-600" />
            </div>
          </div>
          <div className="card-lift animate-fade-up delay-5 flex items-center gap-4 p-5 bg-white dark:bg-gray-900 rounded-xl border border-gray-200/80 dark:border-gray-800/80">
            <div className="flex-1">
              <h3 className="font-semibold text-gray-900 dark:text-white mb-1">
                Easy for hosts
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                We&apos;ll grab your events automatically!
              </p>
            </div>
            <div className="icon-circle">
              <Upload className="w-6 h-6 text-brand-600" />
            </div>
          </div>
          <div className="card-lift animate-fade-up delay-6 flex items-center gap-4 p-5 bg-white dark:bg-gray-900 rounded-xl border border-gray-200/80 dark:border-gray-800/80">
            <div className="flex-1">
              <h3 className="font-semibold text-gray-900 dark:text-white mb-1">
                Your feed, your way
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Filter, customize, curate. Make it yours.
              </p>
            </div>
            <div className="icon-circle">
              <SlidersHorizontal className="w-6 h-6 text-brand-600" />
            </div>
          </div>
        </div>
      </section>

      {/* Quick Filters Section */}
      <section className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-12">
        <h2 className="font-display text-2xl sm:text-3xl font-semibold text-gray-900 dark:text-white mb-8 text-center">
          Jump to a filtered event list
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
        <section className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-12">
          <h2 className="font-display text-2xl sm:text-3xl font-semibold text-gray-900 dark:text-white mb-8 text-center">
            Curated feeds by local experts
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
      <footer className="mt-16 py-12 border-t border-gray-200 dark:border-gray-800">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 text-center">
          <p className="font-display text-xl sm:text-2xl text-gray-800 dark:text-gray-200 mb-6">
            Built for Asheville, not for profit.
          </p>
          <div className="flex flex-wrap justify-center gap-2 sm:gap-4 mb-8 text-sm">
            <a
              href="https://github.com/MattB543/asheville-event-feed"
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            >
              Open source on GitHub
            </a>
            <a
              href="/api/export/json"
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            >
              JSON Feed
            </a>
          </div>
          <div className="text-sm text-gray-500 dark:text-gray-400 space-y-1">
            <p>
              Built by Matt Brooks at Brooks Solutions, LLC.{" "}
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
              © {new Date().getFullYear()} Asheville Event Feed. Not affiliated
              with AVL Today, Eventbrite, Facebook Events, or Meetup.
            </p>
          </div>
        </div>
      </footer>
    </main>
  );
}
