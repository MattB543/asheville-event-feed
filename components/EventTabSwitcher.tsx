"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

interface EventTabSwitcherProps {
  activeTab: "all" | "forYou";
}

export default function EventTabSwitcher({ activeTab }: EventTabSwitcherProps) {
  const searchParams = useSearchParams();

  // Build URL preserving other query params
  const buildTabUrl = (tab: "all" | "forYou") => {
    const params = new URLSearchParams(searchParams.toString());
    if (tab === "all") {
      params.delete("tab");
    } else {
      params.set("tab", tab);
    }
    const queryString = params.toString();
    return `/events${queryString ? `?${queryString}` : ""}`;
  };

  return (
    <nav className="flex items-center gap-1" aria-label="Event feed tabs">
      <Link
        href={buildTabUrl("all")}
        className={`px-3 py-1.5 text-sm font-medium rounded-md cursor-pointer transition-colors ${
          activeTab === "all"
            ? "text-gray-900 dark:text-white bg-gray-100 dark:bg-gray-800"
            : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/50"
        }`}
      >
        All Events
      </Link>
      <Link
        href={buildTabUrl("forYou")}
        className={`px-3 py-1.5 text-sm font-medium rounded-md cursor-pointer transition-colors ${
          activeTab === "forYou"
            ? "text-brand-600 dark:text-brand-400 bg-brand-50 dark:bg-brand-950/30"
            : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/50"
        }`}
      >
        For You
      </Link>
    </nav>
  );
}
