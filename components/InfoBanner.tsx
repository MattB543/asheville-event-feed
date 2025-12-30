"use client";

import { useState, useEffect } from "react";
import { X } from "lucide-react";

const STORAGE_KEY = "infoBannerSeen";

export default function InfoBanner() {
  const [isVisible, setIsVisible] = useState(false); // Start hidden to prevent flash
  const [isLoaded, setIsLoaded] = useState(false);

  // Read localStorage on mount to initialize state (SSR-safe pattern)
  useEffect(() => {
    const hasSeenBefore = localStorage.getItem(STORAGE_KEY) === "true";
    /* eslint-disable react-hooks/set-state-in-effect -- SSR hydration: can't read localStorage during server render */
    // Show banner only on first visit, auto-hide on subsequent visits
    setIsVisible(!hasSeenBefore);
    setIsLoaded(true);
    // Mark as seen for next visit
    if (!hasSeenBefore) {
      localStorage.setItem(STORAGE_KEY, "true");
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const handleDismiss = () => {
    setIsVisible(false);
  };

  // Don't render anything until we've checked localStorage or if not visible
  if (!isLoaded || !isVisible) return null;

  return (
    <div className="w-full max-w-7xl mx-auto px-0 sm:px-6 lg:px-8">
      <div className="bg-brand-50/50 dark:bg-brand-950/20 border border-t-0 border-brand-200/50 dark:border-brand-800/50 sm:rounded-b-lg py-2 px-3 sm:px-4 flex items-center justify-between gap-3">
        <p className="text-xs sm:text-sm text-brand-800/80 dark:text-brand-200/80 flex-1 text-center">
          Your settings &amp; filters will be saved for next time. Email{" "}
          <span className="font-medium">hi@avlgo.com</span> with questions or
          feedback
        </p>
        <button
          onClick={handleDismiss}
          className="text-brand-600 dark:text-brand-400 hover:text-brand-800 dark:hover:text-brand-300 transition-colors p-1 -m-1 cursor-pointer"
          aria-label="Dismiss banner"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
