import { Sparkles } from 'lucide-react';
import { AI_NOTICE } from '@/lib/camps/display';

/** The AI banner near the top of /camps and every camp page (04-v2-plan §1.3). */
export default function AiNotice({ className = '' }: { className?: string }) {
  return (
    <p
      role="note"
      className={`flex items-start gap-2 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-xs sm:text-sm text-amber-900 dark:text-amber-200 ${className}`}
    >
      <Sparkles size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
      <span>{AI_NOTICE}</span>
    </p>
  );
}
