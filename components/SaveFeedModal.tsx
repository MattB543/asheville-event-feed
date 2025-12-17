"use client";

import { useRouter } from "next/navigation";
import { X, UserPlus, Bell } from "lucide-react";

interface SaveFeedModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function SaveFeedModal({ isOpen, onClose }: SaveFeedModalProps) {
  const router = useRouter();

  if (!isOpen) return null;

  const handleCreateAccount = () => {
    router.push("/login");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-800 max-w-md w-full p-6 animate-fade-in">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Icon */}
        <div className="flex justify-center mb-4">
          <div className="w-16 h-16 rounded-full bg-brand-100 dark:bg-brand-900/30 flex items-center justify-center">
            <Bell className="w-8 h-8 text-brand-600 dark:text-brand-400" />
          </div>
        </div>

        {/* Content */}
        <h2 className="text-xl font-bold text-gray-900 dark:text-white text-center mb-2">
          Save Your Custom Feed
        </h2>
        <p className="text-gray-600 dark:text-gray-400 text-center mb-6">
          Create an account to save your custom feed. You can even set custom email notifications!
        </p>

        {/* Actions */}
        <div className="space-y-3">
          <button
            onClick={handleCreateAccount}
            className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-lg bg-brand-600 hover:bg-brand-700 text-white font-medium transition-colors cursor-pointer"
          >
            <UserPlus className="w-5 h-5" />
            Create Account
          </button>
          <button
            onClick={onClose}
            className="w-full px-6 py-3 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors cursor-pointer"
          >
            Maybe Later
          </button>
        </div>
      </div>
    </div>
  );
}
