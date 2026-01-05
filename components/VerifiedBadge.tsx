'use client';

import { CheckCircle } from 'lucide-react';

interface VerifiedBadgeProps {
  className?: string;
  size?: number;
}

export default function VerifiedBadge({ className = '', size = 18 }: VerifiedBadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 text-brand-600 dark:text-brand-400 ${className}`}
      title="Verified Curator"
    >
      <CheckCircle size={size} className="fill-brand-100 dark:fill-brand-900" strokeWidth={2.5} />
    </span>
  );
}
