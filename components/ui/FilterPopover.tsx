'use client';

import { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';

interface FilterPopoverProps {
  trigger: React.ReactNode;
  children: React.ReactNode;
  align?: 'left' | 'right';
}

export default function FilterPopover({ trigger, children, align = 'left' }: FilterPopoverProps) {
  const [isOpen, setIsOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Close on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(event.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
    return undefined;
  }, [isOpen]);

  // Close on escape key
  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }
    return undefined;
  }, [isOpen]);

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        {trigger}
        <ChevronDown size={16} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div
          ref={popoverRef}
          className={`absolute top-full mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-lg min-w-[200px] ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
          role="dialog"
          aria-modal="true"
        >
          {children}
        </div>
      )}
    </div>
  );
}

interface FilterPopoverHeaderProps {
  children: React.ReactNode;
}

export function FilterPopoverHeader({ children }: FilterPopoverHeaderProps) {
  return (
    <div className="px-3 py-2 border-b border-gray-100 font-medium text-sm text-gray-900">
      {children}
    </div>
  );
}

interface FilterPopoverContentProps {
  children: React.ReactNode;
}

export function FilterPopoverContent({ children }: FilterPopoverContentProps) {
  return <div className="p-2 max-h-64 overflow-y-auto">{children}</div>;
}

interface FilterPopoverFooterProps {
  children: React.ReactNode;
}

export function FilterPopoverFooter({ children }: FilterPopoverFooterProps) {
  return (
    <div className="px-3 py-2 border-t border-gray-100 flex justify-end gap-2">{children}</div>
  );
}
