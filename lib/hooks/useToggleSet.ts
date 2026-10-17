import { useCallback, useState } from 'react';

/** A set of ids that each flip on and off, e.g. which phone cards are expanded. */
export function useToggleSet(): { has: (id: string) => boolean; toggle: (id: string) => void } {
  const [ids, setIds] = useState<Set<string>>(new Set());
  const toggle = useCallback(
    (id: string) =>
      setIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    []
  );
  return { has: (id: string) => ids.has(id), toggle };
}
