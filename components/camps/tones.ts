import type { RegistrationLine } from '@/lib/camps/display';

/** The registration line's colors, on cards and camp pages. Not a client module, so both can import it. */
export const TONE_CLASSES: Record<RegistrationLine['tone'], string> = {
  upcoming:
    'bg-brand-50 text-brand-900 dark:bg-brand-950/60 dark:text-brand-100 border-brand-200 dark:border-brand-800',
  open: 'bg-emerald-50 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-100 border-emerald-200 dark:border-emerald-800',
  closed:
    'bg-rose-50 text-rose-900 dark:bg-rose-950/50 dark:text-rose-100 border-rose-200 dark:border-rose-800',
  tentative:
    'bg-amber-50 text-amber-900 dark:bg-amber-950/50 dark:text-amber-100 border-amber-200 dark:border-amber-800',
  unknown:
    'bg-gray-50 text-gray-800 dark:bg-gray-800/60 dark:text-gray-200 border-gray-200 dark:border-gray-700',
};
