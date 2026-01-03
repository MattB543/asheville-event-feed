'use client';

import { X } from 'lucide-react';

interface FilterChipProps {
  label: string;
  onRemove?: () => void;
  variant?: 'default' | 'active' | 'muted' | 'include' | 'exclude';
  className?: string;
}

const variantStyles = {
  default:
    'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 border-gray-200 dark:border-gray-700 hover:bg-gray-200 dark:hover:bg-gray-700',
  active:
    'bg-brand-100 dark:bg-brand-900/50 text-brand-800 dark:text-brand-200 border-brand-200 dark:border-brand-700 hover:bg-brand-200 dark:hover:bg-brand-800/50',
  muted:
    'bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-100 dark:border-gray-700',
  include:
    'bg-green-100 dark:bg-green-900/50 text-green-800 dark:text-green-200 border-green-200 dark:border-green-700 hover:bg-green-200 dark:hover:bg-green-800/50',
  exclude:
    'bg-red-100 dark:bg-red-900/50 text-red-800 dark:text-red-200 border-red-200 dark:border-red-700 hover:bg-red-200 dark:hover:bg-red-800/50',
};

export default function FilterChip({
  label,
  onRemove,
  variant = 'active',
  className = '',
}: FilterChipProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${variantStyles[variant]} ${className}`}
    >
      {label}
      {onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="ml-0.5 p-0.5 rounded-full hover:bg-black/10 transition-colors"
          aria-label={`Remove ${label} filter`}
        >
          <X size={12} />
        </button>
      )}
    </span>
  );
}
