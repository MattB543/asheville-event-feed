"use client";

import { useState } from "react";
import { X } from "lucide-react";

interface CurateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (note?: string) => void;
  eventTitle: string;
}

export default function CurateModal({ isOpen, onClose, onConfirm, eventTitle }: CurateModalProps) {
  const [note, setNote] = useState("");

  if (!isOpen) return null;

  const handleSubmit = () => {
    onConfirm(note.trim() || undefined);
    setNote("");
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-md mx-4 p-6">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-pointer"
        >
          <X size={20} />
        </button>

        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
          Curate this event
        </h2>

        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
          Adding &ldquo;{eventTitle}&rdquo; to your curated list.
        </p>

        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Add a note (optional)
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 280))}
            placeholder="Why do you recommend this event?"
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
            rows={3}
          />
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 text-right">
            {note.length}/280
          </p>
        </div>

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            className="flex-1 px-4 py-2 text-sm font-medium text-white bg-brand-600 rounded-lg hover:bg-brand-700 transition-colors cursor-pointer"
          >
            Curate
          </button>
        </div>
      </div>
    </div>
  );
}
