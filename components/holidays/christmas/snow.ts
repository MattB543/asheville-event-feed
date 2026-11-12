import { useSyncExternalStore } from 'react';

// Who wants snow right now: the tree, the winter ambience track, or both
const wanted = new Set<string>();
const listeners = new Set<() => void>();

export function setSnow(source: string, on: boolean) {
  if (on) wanted.add(source);
  else wanted.delete(source);
  listeners.forEach((listener) => listener());
}

export function stopAllSnow() {
  wanted.clear();
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function useSnowing(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => wanted.size > 0,
    () => false
  );
}
