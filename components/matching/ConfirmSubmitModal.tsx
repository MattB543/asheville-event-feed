'use client';

import { useRef } from 'react';
import { X, CheckCircle, Loader2 } from 'lucide-react';
import { useModal } from '@/lib/hooks/useModal';

interface ConfirmSubmitModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isSubmitting?: boolean;
  answeredCount?: number;
  canEditAfterSubmit?: boolean;
}

export default function ConfirmSubmitModal({
  isOpen,
  onClose,
  onConfirm,
  isSubmitting = false,
  answeredCount = 0,
  canEditAfterSubmit = true,
}: ConfirmSubmitModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);

  useModal(
    isOpen,
    () => {
      if (!isSubmitting) onClose();
    },
    modalRef
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={isSubmitting ? undefined : onClose}
      />
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className="relative outline-none bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-800 max-w-md w-full p-6 animate-fade-in"
      >
        <button
          onClick={isSubmitting ? undefined : onClose}
          disabled={isSubmitting}
          className="absolute top-4 right-4 p-1 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex justify-center mb-4">
          <div className="w-16 h-16 rounded-full bg-brand-50 dark:bg-brand-900/20 flex items-center justify-center">
            <CheckCircle className="w-8 h-8 text-brand-600 dark:text-brand-400" />
          </div>
        </div>

        <h2 className="text-xl font-bold text-gray-900 dark:text-white text-center mb-2">
          Ready to submit?
        </h2>
        <div className="text-center mb-6 space-y-2">
          <p className="text-gray-600 dark:text-gray-400">
            {canEditAfterSubmit
              ? 'You can still edit your answers anytime until event day.'
              : 'You will not be able to edit after this submission.'}
          </p>
          {answeredCount === 1 && (
            <p className="text-sm text-brand-700 dark:text-brand-300">
              You answered one question. More answers can improve match quality.
            </p>
          )}
        </div>

        <div className="space-y-3">
          <button
            onClick={onConfirm}
            disabled={isSubmitting}
            className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-lg bg-brand-600 hover:bg-brand-700 text-white font-medium transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Submitting...
              </>
            ) : (
              'Yes, submit my profile'
            )}
          </button>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="w-full px-6 py-3 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
          >
            Not yet
          </button>
        </div>
      </div>
    </div>
  );
}
