'use client';

import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import CampFeedback from './CampFeedback';

/**
 * The AI banner near the top of /camps and every camp page (04-v2-plan §1.3). Its link opens the
 * feedback form, about the camp on a camp's page.
 */
export default function AiNotice({
  className = '',
  campId,
  campName,
}: {
  className?: string;
  campId?: string;
  campName?: string;
}) {
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  return (
    <>
      <p
        role="note"
        className={`flex items-start gap-2 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-xs sm:text-sm text-amber-900 dark:text-amber-200 ${className}`}
      >
        <Sparkles size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
        <span>
          Info pulled by AI. Double-check with the camp before booking anything.{' '}
          <button
            type="button"
            onClick={() => setFeedbackOpen(true)}
            className="text-left hover:text-amber-700 dark:hover:text-amber-100 rounded cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <span className="underline underline-offset-2">Click here</span> to give feedback or
            report missing / wrong data
          </button>
        </span>
      </p>
      {feedbackOpen && (
        <CampFeedback campId={campId} campName={campName} onClose={() => setFeedbackOpen(false)} />
      )}
    </>
  );
}
