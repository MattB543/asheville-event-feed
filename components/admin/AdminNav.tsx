import Link from 'next/link';
import { CalendarRange, Image, Tent } from 'lucide-react';

const AREAS = [
  { href: '/admin/banners', label: 'Banners', icon: CalendarRange },
  { href: '/admin/camps', label: 'Camp review', icon: Tent },
  { href: '/admin/posters', label: 'Posters', icon: Image },
] as const;

/** The admin pages as tabs, which are also each page's header */
export default function AdminNav({ current }: { current: (typeof AREAS)[number]['href'] }) {
  return (
    <nav
      aria-label="Admin"
      className="mb-6 flex items-center gap-1 overflow-x-auto border-b border-gray-200 dark:border-gray-800"
    >
      {AREAS.map(({ href, label, icon: Icon }) => {
        const active = href === current;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={`-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 pb-3 pt-1 text-lg font-semibold transition-colors ${
              active
                ? 'border-brand-600 text-brand-700 dark:border-brand-400 dark:text-brand-300'
                : 'border-transparent text-gray-600 hover:border-gray-300 hover:text-gray-900 dark:text-gray-400 dark:hover:border-gray-600 dark:hover:text-gray-100'
            }`}
          >
            <Icon aria-hidden="true" className="h-5 w-5" />
            {active ? <h1>{label}</h1> : label}
          </Link>
        );
      })}
    </nav>
  );
}
