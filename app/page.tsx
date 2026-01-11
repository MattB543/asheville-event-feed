import type { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import Header from '@/components/Header';
import HomeFilterButton from '@/components/HomeFilterButton';
import {
  Users,
  Music,
  Trophy,
  Gamepad2,
  Utensils,
  Mountain,
  Gift,
  Calendar,
  List,
  ArrowRight,
  Star,
  Database,
  ShieldOff,
  Code,
  Sparkles,
  Upload,
  SlidersHorizontal,
} from 'lucide-react';

export const metadata: Metadata = {
  title: 'AVL GO - Asheville Events',
  description:
    'Discover Asheville events aggregated from 10+ sources. Find family events, live music, sports, trivia, and more.',
};

export const revalidate = 3600; // Revalidate every hour

const FILTER_BUTTONS = [
  { label: 'Family', href: '/events?tagsInclude=Family', icon: Users },
  {
    label: 'Live Music',
    href: '/events?tagsInclude=Live%20Music',
    icon: Music,
  },
  { label: 'Sports', href: '/events?tagsInclude=Sports', icon: Trophy },
  {
    label: 'Trivia & Games',
    href: '/events?tagsInclude=Trivia',
    icon: Gamepad2,
  },
  { label: 'Food & Drink', href: '/events?tagsInclude=Dining', icon: Utensils },
  { label: 'Outdoors', href: '/events?tagsInclude=Outdoors', icon: Mountain },
  { label: 'Free Events', href: '/events?priceFilter=free', icon: Gift },
  { label: 'This Weekend', href: '/events?dateFilter=weekend', icon: Calendar },
];

export default function HomePage() {
  return (
    <main className="min-h-screen bg-[var(--background)] bg-texture">
      <Header />

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
            Asheville events
            <br />
            <span className="text-brand-600 dark:text-brand-400">All in one place</span>
          </h1>
          <p className="text-lg sm:text-xl font-medium text-gray-800 dark:text-gray-200 mb-10 max-w-2xl mx-auto leading-relaxed">
            Dozens of sources. No ads or sponsorships. No broken incentives.
            <br />
            Just awesome events.
          </p>
          <Link
            href="/events/top30"
            className="btn-shimmer inline-flex items-center gap-2.5 bg-brand-600 hover:bg-brand-700 text-white font-semibold rounded-full px-8 py-4 transition-colors cursor-pointer shadow-lg shadow-brand-600/25 hover:shadow-brand-600/40"
          >
            <Calendar className="w-5 h-5" />
            View Top Events
          </Link>
          <div className="mt-4">
            <Link
              href="/events?dateFilter=today"
              className="text-sm text-gray-600 dark:text-gray-400 hover:text-brand-600 dark:hover:text-brand-400 underline underline-offset-2 transition-colors"
            >
              View today&apos;s events
            </Link>
          </div>
        </div>
      </section>

      {/* Quick Filters Section */}
      <section className="relative z-10 max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-12">
        <h2 className="font-display text-2xl sm:text-3xl font-semibold text-gray-900 dark:text-white mb-8 text-center">
          Jump into an event list
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
          <Link href="/events" className="sm:col-start-2">
            <div className="group flex items-center gap-3 p-4 bg-white dark:bg-gray-900 rounded-xl border border-brand-300 dark:border-brand-700 hover:border-brand-400 dark:hover:border-brand-500 hover:shadow-lg hover:shadow-brand-600/5 dark:hover:shadow-brand-400/5 transition-all duration-200 cursor-pointer hover:-translate-y-0.5">
              <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-brand-50 dark:bg-brand-950/50 group-hover:bg-brand-100 dark:group-hover:bg-brand-900/50 transition-colors">
                <List className="w-5 h-5 text-brand-600 dark:text-brand-400" />
              </div>
              <span className="text-sm font-medium text-gray-900 dark:text-white flex-1">
                All Events
              </span>
              <ArrowRight className="w-4 h-4 text-gray-400 dark:text-gray-500 group-hover:text-brand-500 dark:group-hover:text-brand-400 group-hover:translate-x-1 transition-all duration-200" />
            </div>
          </Link>
          <Link href="/events/top30">
            <div className="group flex items-center gap-3 p-4 bg-white dark:bg-gray-900 rounded-xl border border-brand-300 dark:border-brand-700 hover:border-brand-400 dark:hover:border-brand-500 hover:shadow-lg hover:shadow-brand-600/5 dark:hover:shadow-brand-400/5 transition-all duration-200 cursor-pointer hover:-translate-y-0.5">
              <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-brand-50 dark:bg-brand-950/50 group-hover:bg-brand-100 dark:group-hover:bg-brand-900/50 transition-colors">
                <Star className="w-5 h-5 text-brand-600 dark:text-brand-400" />
              </div>
              <span className="text-sm font-medium text-gray-900 dark:text-white flex-1">
                Top 30 Events
              </span>
              <ArrowRight className="w-4 h-4 text-gray-400 dark:text-gray-500 group-hover:text-brand-500 dark:group-hover:text-brand-400 group-hover:translate-x-1 transition-all duration-200" />
            </div>
          </Link>
        </div>
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

      {/* TODO: Add back after curation filtering is built
      {curators.length > 0 && (
        <section className="relative z-10 max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-12">
          <div className="border-t border-gray-200 dark:border-gray-800 mb-12 mx-4 sm:mx-8" />
          <h2 className="font-display text-2xl sm:text-3xl font-semibold text-gray-900 dark:text-white mb-8 text-center">
            Curated feeds by local experts
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {curators.map((curator) => (
              <PublicCuratorCard
                key={curator.userId}
                slug={curator.slug}
                displayName={curator.displayName}
                title={curator.title}
                bio={curator.bio}
                avatarUrl={curator.avatarUrl}
                showProfilePicture={curator.showProfilePicture}
                curationCount={curator.curationCount}
              />
            ))}
          </div>
        </section>
      )}
      */}

      {/* Why Section */}
      <section className="relative z-10 max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-12">
        <div className="border-t border-gray-200 dark:border-gray-800 mb-12 mx-4 sm:mx-8" />
        <h2 className="font-display text-2xl sm:text-3xl font-semibold text-gray-900 dark:text-white mb-8 text-center">
          Why AVL GO?
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="card-lift flex items-center gap-4 p-5 bg-white dark:bg-gray-900 rounded-xl border border-gray-200/80 dark:border-gray-800/80">
            <div className="flex-1 text-left">
              <h3 className="font-semibold text-gray-900 dark:text-white mb-1">All in one place</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Every AVL event source in one clean feed.
              </p>
            </div>
            <div className="icon-circle">
              <Database className="w-6 h-6 text-brand-600" />
            </div>
          </div>
          <div className="card-lift flex items-center gap-4 p-5 bg-white dark:bg-gray-900 rounded-xl border border-gray-200/80 dark:border-gray-800/80">
            <div className="flex-1 text-left">
              <h3 className="font-semibold text-gray-900 dark:text-white mb-1">No ads, ever</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                No sponsors. No promotions. Free forever.
              </p>
            </div>
            <div className="icon-circle">
              <ShieldOff className="w-6 h-6 text-brand-600" />
            </div>
          </div>
          <div className="card-lift flex items-center gap-4 p-5 bg-white dark:bg-gray-900 rounded-xl border border-gray-200/80 dark:border-gray-800/80">
            <div className="flex-1 text-left">
              <h3 className="font-semibold text-gray-900 dark:text-white mb-1">
                Open source, open data
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                All data available via{' '}
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
          <div className="card-lift flex items-center gap-4 p-5 bg-white dark:bg-gray-900 rounded-xl border border-gray-200/80 dark:border-gray-800/80">
            <div className="flex-1 text-left">
              <h3 className="font-semibold text-gray-900 dark:text-white mb-1">AI-enhanced</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Auto-tags, smart search, similar events.
              </p>
            </div>
            <div className="icon-circle">
              <Sparkles className="w-6 h-6 text-brand-600" />
            </div>
          </div>
          <div className="card-lift flex items-center gap-4 p-5 bg-white dark:bg-gray-900 rounded-xl border border-gray-200/80 dark:border-gray-800/80">
            <div className="flex-1 text-left">
              <h3 className="font-semibold text-gray-900 dark:text-white mb-1">Easy for hosts</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                We&apos;ll grab your events automatically!
              </p>
            </div>
            <div className="icon-circle">
              <Upload className="w-6 h-6 text-brand-600" />
            </div>
          </div>
          <div className="card-lift flex items-center gap-4 p-5 bg-white dark:bg-gray-900 rounded-xl border border-gray-200/80 dark:border-gray-800/80">
            <div className="flex-1 text-left">
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

      {/* Footer */}
      <footer className="relative z-10 mt-16 py-12 border-t border-gray-200 dark:border-gray-800">
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
              Built by{' '}
              <a
                href="https://mattbrooks.xyz"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-gray-700 dark:hover:text-gray-300"
              >
                Matt
              </a>{' '}
              at Brooks Solutions, LLC.
            </p>
            <p>
              © {new Date().getFullYear()} AVL GO. Not affiliated with AVL Today, Eventbrite,
              Facebook Events, or Meetup.
            </p>
          </div>
        </div>
      </footer>
    </main>
  );
}
