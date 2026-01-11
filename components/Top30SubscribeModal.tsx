'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { X, Bell, UserPlus, Loader2 } from 'lucide-react';
import { type Top30SubscriptionType } from '@/lib/newsletter/types';

interface Top30SubscribeModalProps {
  isOpen: boolean;
  onClose: () => void;
  isLoggedIn: boolean;
  currentSubscription: Top30SubscriptionType;
  onSubscriptionChange: (subscription: Top30SubscriptionType) => void;
}

export default function Top30SubscribeModal({
  isOpen,
  onClose,
  isLoggedIn,
  currentSubscription,
  onSubscriptionChange,
}: Top30SubscribeModalProps) {
  const router = useRouter();
  const [selectedOption, setSelectedOption] = useState<Top30SubscriptionType>(currentSubscription);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset selected option when modal opens or subscription changes
  useEffect(() => {
    if (isOpen) {
      setSelectedOption(currentSubscription);
      setError(null);
    }
  }, [isOpen, currentSubscription]);

  if (!isOpen) return null;

  const handleCreateAccount = () => {
    router.push('/login');
  };

  const handleSave = async () => {
    if (selectedOption === currentSubscription) {
      onClose();
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const response = await fetch('/api/top30/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: selectedOption }),
      });

      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error || 'Failed to save subscription');
      }

      onSubscriptionChange(selectedOption);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setIsSaving(false);
    }
  };

  // Not logged in view
  if (!isLoggedIn) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
        <div className="relative bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-800 max-w-md w-full p-6 animate-fade-in">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-1 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="flex justify-center mb-4">
            <div className="w-16 h-16 rounded-full bg-[#e8f4f8] dark:bg-[#1a3a4a] flex items-center justify-center">
              <Bell className="w-8 h-8 text-[#2a7d9c] dark:text-[#7ec8e3]" />
            </div>
          </div>

          <h2 className="text-xl font-bold text-gray-900 dark:text-white text-center mb-2">
            Get Top 30 Notifications
          </h2>
          <p className="text-gray-600 dark:text-gray-400 text-center mb-6">
            Create an account to get notified when new events hit the Top 30 list.
          </p>

          <div className="space-y-3">
            <button
              onClick={handleCreateAccount}
              className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-lg bg-[#2a7d9c] hover:bg-[#1f6a87] text-white font-medium transition-colors cursor-pointer"
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

  // Logged in view with subscription options
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-800 max-w-md w-full p-6 animate-fade-in">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex justify-center mb-4">
          <div className="w-16 h-16 rounded-full bg-[#e8f4f8] dark:bg-[#1a3a4a] flex items-center justify-center">
            <Bell className="w-8 h-8 text-[#2a7d9c] dark:text-[#7ec8e3]" />
          </div>
        </div>

        <h2 className="text-xl font-bold text-gray-900 dark:text-white text-center mb-2">
          Top 30 Notifications
        </h2>
        <p className="text-gray-600 dark:text-gray-400 text-center mb-6">
          How often do you want to hear about new Top 30 events?
        </p>

        <div className="space-y-3 mb-6">
          <label
            className={`flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition-colors ${
              selectedOption === 'none'
                ? 'border-[#2a7d9c] bg-[#e8f4f8] dark:bg-[#1a3a4a]'
                : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
            }`}
          >
            <input
              type="radio"
              name="subscription"
              value="none"
              checked={selectedOption === 'none'}
              onChange={() => setSelectedOption('none')}
              className="mt-0.5 accent-[#2a7d9c]"
            />
            <div>
              <div className="font-medium text-gray-900 dark:text-white">Off</div>
              <div className="text-sm text-gray-500 dark:text-gray-400">No email notifications</div>
            </div>
          </label>

          <label
            className={`flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition-colors ${
              selectedOption === 'live'
                ? 'border-[#2a7d9c] bg-[#e8f4f8] dark:bg-[#1a3a4a]'
                : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
            }`}
          >
            <input
              type="radio"
              name="subscription"
              value="live"
              checked={selectedOption === 'live'}
              onChange={() => setSelectedOption('live')}
              className="mt-0.5 accent-[#2a7d9c]"
            />
            <div>
              <div className="font-medium text-gray-900 dark:text-white">Live Updates</div>
              <div className="text-sm text-gray-500 dark:text-gray-400">
                Email each time new events enter the Top 30
              </div>
            </div>
          </label>

          <label
            className={`flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition-colors ${
              selectedOption === 'weekly'
                ? 'border-[#2a7d9c] bg-[#e8f4f8] dark:bg-[#1a3a4a]'
                : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
            }`}
          >
            <input
              type="radio"
              name="subscription"
              value="weekly"
              checked={selectedOption === 'weekly'}
              onChange={() => setSelectedOption('weekly')}
              className="mt-0.5 accent-[#2a7d9c]"
            />
            <div>
              <div className="font-medium text-gray-900 dark:text-white">Weekly Digest</div>
              <div className="text-sm text-gray-500 dark:text-gray-400">
                Full Top 30 roundup every Friday at 10 AM
              </div>
            </div>
          </label>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 text-sm">
            {error}
          </div>
        )}

        <button
          onClick={() => void handleSave()}
          disabled={isSaving}
          className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-lg bg-[#2a7d9c] hover:bg-[#1f6a87] disabled:bg-[#7ec8e3] text-white font-medium transition-colors cursor-pointer disabled:cursor-not-allowed"
        >
          {isSaving ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Saving...
            </>
          ) : (
            'Save'
          )}
        </button>
      </div>
    </div>
  );
}
