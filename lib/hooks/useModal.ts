import { useEffect, useRef, type RefObject } from 'react';

// Open modals, newest last: only the top one answers Escape and traps Tab, so closing
// a lightbox over an event modal doesn't close both
const openModals: symbol[] = [];
let savedBodyStyle: { overflow: string; paddingRight: string } | null = null;

function lockScroll() {
  if (openModals.length > 1) return;
  const { body } = document;
  savedBodyStyle = { overflow: body.style.overflow, paddingRight: body.style.paddingRight };
  // Padding in place of the scrollbar keeps the page behind from shifting sideways
  const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
  body.style.overflow = 'hidden';
  if (scrollbarWidth > 0) body.style.paddingRight = `${scrollbarWidth}px`;
}

function unlockScroll() {
  if (openModals.length > 0 || !savedBodyStyle) return;
  document.body.style.overflow = savedBodyStyle.overflow;
  document.body.style.paddingRight = savedBodyStyle.paddingRight;
  savedBodyStyle = null;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function trapTab(event: KeyboardEvent, dialog: HTMLElement) {
  const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) => element.offsetParent !== null
  );
  if (focusable.length === 0) {
    event.preventDefault();
    dialog.focus();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement as HTMLElement | null;
  // Focus on the dialog itself (as on open) isn't in the list; without this the
  // first Shift+Tab walks out to the page behind
  if (!active || !focusable.includes(active)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  } else if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

/**
 * What every modal needs while open: Escape closes it, Tab stays inside, the page
 * behind doesn't scroll, and focus moves in on open and back to the opener on close.
 * `dialogRef` needs tabIndex={-1} so it can hold focus.
 */
export function useModal(
  open: boolean,
  onClose: () => void,
  dialogRef: RefObject<HTMLElement | null>,
  initialFocusRef?: RefObject<HTMLElement | null>
) {
  // Latest onClose, so callers can pass an inline closure
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    if (!open) return undefined;
    const id = Symbol();
    openModals.push(id);
    lockScroll();
    const opener = document.activeElement as HTMLElement | null;
    (initialFocusRef?.current ?? dialogRef.current)?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (openModals[openModals.length - 1] !== id) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        // Caught first (capture phase) so nothing underneath reacts too
        event.stopImmediatePropagation();
        close.current();
      } else if (event.key === 'Tab' && dialogRef.current) {
        trapTab(event, dialogRef.current);
      }
    };
    document.addEventListener('keydown', onKeyDown, true);

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      openModals.splice(openModals.indexOf(id), 1);
      unlockScroll();
      if (opener?.isConnected) opener.focus();
    };
  }, [open, dialogRef, initialFocusRef]);
}
