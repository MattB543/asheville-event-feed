/**
 * A tooltip under a link or button, shown on hover and keyboard focus with no script, for
 * controls whose tap must still do their own thing (Tooltip takes the tap to toggle). The
 * parent needs `group/tip relative`. Styled like Tooltip.
 */
export default function HoverTip({ children }: { children: string }) {
  return (
    <span
      role="tooltip"
      className="pointer-events-none absolute left-1/2 top-full z-[60] mt-2 w-max max-w-64 -translate-x-1/2 rounded border border-gray-200 bg-white px-2 py-1.5 text-xs font-normal text-gray-700 opacity-0 shadow-lg transition-opacity group-hover/tip:opacity-100 group-focus-visible/tip:opacity-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
    >
      {children}
    </span>
  );
}
