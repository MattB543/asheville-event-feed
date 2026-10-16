import { useEffect, useRef, type RefObject } from 'react';

/**
 * Closes an open dropdown on a press outside `insideRefs` or on Escape. Escape also
 * hands focus back to `triggerRef`, and is caught first so a modal the menu sits in
 * stays open.
 */
export function useDismiss(
  open: boolean,
  close: () => void,
  insideRefs: RefObject<HTMLElement | null>[],
  triggerRef?: RefObject<HTMLElement | null>
) {
  // Latest values, so callers can pass inline closures and arrays
  const latest = useRef({ close, insideRefs, triggerRef });
  useEffect(() => {
    latest.current = { close, insideRefs, triggerRef };
  });

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (latest.current.insideRefs.some((ref) => ref.current?.contains(target))) return;
      latest.current.close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      latest.current.close();
      latest.current.triggerRef?.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open]);
}
