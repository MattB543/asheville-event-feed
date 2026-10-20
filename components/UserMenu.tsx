'use client';

import { Suspense, useState, useRef, useMemo, useId, type FocusEvent } from 'react';
import { useAuth } from './AuthProvider';
import { User, LogOut, ChevronDown, UserCircle } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useDismiss } from '@/lib/hooks/useDismiss';

const MENU_ITEM_CLASS =
  'w-full flex items-center gap-2 px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors focus-visible:outline-none focus-visible:bg-gray-100 dark:focus-visible:bg-gray-800 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500';

const TRIGGER_FOCUS_CLASS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500';

/**
 * useSearchParams() needs its own Suspense boundary: without one, a statically
 * rendered page bails out to client-side rendering at the root loading boundary
 * and ships no HTML content at all. The fallback is the same menu, whose login
 * link just doesn't carry the current query until hydration.
 */
export default function UserMenu() {
  return (
    <Suspense fallback={<UserMenuContent query="" />}>
      <UserMenuWithQuery />
    </Suspense>
  );
}

function UserMenuWithQuery() {
  const searchParams = useSearchParams();
  return <UserMenuContent query={searchParams.toString()} />;
}

function UserMenuContent({ query }: { query: string }) {
  const { user, isLoading, signOut } = useAuth();
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  const loginHref = useMemo(() => {
    if (!pathname) {
      return '/login';
    }

    // Avoid redirect loops on auth pages.
    if (pathname === '/login' || pathname.startsWith('/auth')) {
      return '/login';
    }

    const currentPath = query ? `${pathname}?${query}` : pathname;
    return `/login?next=${encodeURIComponent(currentPath)}`;
  }, [pathname, query]);

  useDismiss(isOpen, () => setIsOpen(false), [menuRef], buttonRef);

  // A disclosure, not an ARIA menu: Tab moves through the links, so close once focus leaves it.
  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsOpen(false);
  };

  // Handle sign out
  const handleSignOut = async () => {
    setIsOpen(false);
    await signOut();
  };

  // Show nothing while loading
  if (isLoading) {
    return <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 animate-pulse" />;
  }

  // Not logged in - just a sign-in link (Your List lives in the Events menu)
  if (!user) {
    return (
      <Link
        href={loginHref}
        className={`flex p-1.5 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${TRIGGER_FOCUS_CLASS}`}
        aria-label="Sign in"
      >
        <User size={16} className="text-gray-600 dark:text-gray-300" />
      </Link>
    );
  }

  // Logged in - show user menu dropdown
  const email = user.email || 'User';
  const metadata = user.user_metadata as Record<string, unknown> | null;
  const avatarUrl =
    metadata && typeof metadata.avatar_url === 'string'
      ? metadata.avatar_url
      : metadata && typeof metadata.picture === 'string'
        ? metadata.picture
        : null;

  return (
    <div className="relative" ref={menuRef} onBlur={handleBlur}>
      {/* 32px tall (py-0.5 around the 28px avatar), the same as the loading
          placeholder and the lg tabs, so the header doesn't grow once auth resolves.
          flex, not inline-flex: an inline box adds descender space under it */}
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-1 px-1.5 py-0.5 text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors cursor-pointer ${TRIGGER_FOCUS_CLASS}`}
        aria-label="Account menu"
        aria-expanded={isOpen}
        aria-controls={isOpen ? menuId : undefined}
      >
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarUrl}
            alt="Profile"
            className="w-7 h-7 rounded-full object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="w-7 h-7 rounded-full bg-brand-600 flex items-center justify-center">
            <User className="w-4 h-4 text-white" />
          </div>
        )}
        <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div
          id={menuId}
          className="absolute right-0 mt-2 w-56 bg-white dark:bg-gray-900 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 py-1 z-50"
        >
          {/* User info */}
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
            <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{email}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Signed in</p>
          </div>

          {/* Menu items */}
          <Link href="/profile" onClick={() => setIsOpen(false)} className={MENU_ITEM_CLASS}>
            <UserCircle className="w-4 h-4" />
            Profile
          </Link>
          <button
            type="button"
            onClick={() => void handleSignOut()}
            className={`${MENU_ITEM_CLASS} cursor-pointer`}
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
