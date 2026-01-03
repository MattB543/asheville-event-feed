import Link from 'next/link';
import { type LucideIcon, ArrowRight } from 'lucide-react';

interface HomeFilterButtonProps {
  label: string;
  href: string;
  icon: LucideIcon;
}

export default function HomeFilterButton({ label, href, icon: Icon }: HomeFilterButtonProps) {
  return (
    <Link href={href}>
      <div className="group flex items-center gap-3 p-4 bg-white dark:bg-gray-900 rounded-xl border border-gray-200/80 dark:border-gray-800/80 hover:border-brand-400 dark:hover:border-brand-500 hover:shadow-lg hover:shadow-brand-600/5 dark:hover:shadow-brand-400/5 transition-all duration-200 cursor-pointer hover:-translate-y-0.5">
        <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-brand-50 dark:bg-brand-950/50 group-hover:bg-brand-100 dark:group-hover:bg-brand-900/50 transition-colors">
          <Icon className="w-5 h-5 text-brand-600 dark:text-brand-400" />
        </div>
        <span className="text-sm font-medium text-gray-900 dark:text-white flex-1">{label}</span>
        <ArrowRight className="w-4 h-4 text-gray-400 dark:text-gray-500 group-hover:text-brand-500 dark:group-hover:text-brand-400 group-hover:translate-x-1 transition-all duration-200" />
      </div>
    </Link>
  );
}
