import Link from "next/link";
import { LucideIcon } from "lucide-react";

interface HomeFilterButtonProps {
  label: string;
  href: string;
  icon: LucideIcon;
}

export default function HomeFilterButton({ label, href, icon: Icon }: HomeFilterButtonProps) {
  return (
    <Link href={href}>
      <div className="flex items-center gap-3 p-4 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-brand-500 dark:hover:border-brand-400 hover:shadow-md transition-all cursor-pointer">
        <Icon className="w-5 h-5 text-brand-600 dark:text-brand-400 flex-shrink-0" />
        <span className="text-sm font-medium text-gray-900 dark:text-white">{label}</span>
      </div>
    </Link>
  );
}
