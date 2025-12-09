"use client";

import { X, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import ChipInput from "./ui/ChipInput";

interface HiddenEventFingerprint {
  title: string;
  organizer: string;
}

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  blockedHosts: string[];
  blockedKeywords: string[];
  hiddenEvents: HiddenEventFingerprint[];
  onUpdateHosts: (hosts: string[]) => void;
  onUpdateKeywords: (keywords: string[]) => void;
  onUpdateHiddenEvents: (events: HiddenEventFingerprint[]) => void;
  useDefaultFilters: boolean;
  onToggleDefaultFilters: (enabled: boolean) => void;
  defaultFilterKeywords: string[];
}

export default function SettingsModal({
  isOpen,
  onClose,
  blockedHosts,
  blockedKeywords,
  hiddenEvents,
  onUpdateHosts,
  onUpdateKeywords,
  onUpdateHiddenEvents,
  useDefaultFilters,
  onToggleDefaultFilters,
  defaultFilterKeywords,
}: SettingsModalProps) {
  const [showDefaultKeywords, setShowDefaultKeywords] = useState(false);
  const [showHiddenEvents, setShowHiddenEvents] = useState(false);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center p-6 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Feed Settings</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <X size={24} />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Default Filters Section */}
          <div className="p-4 bg-brand-50 dark:bg-brand-950/30 border border-brand-200 dark:border-brand-800 rounded-lg">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <h3 className="font-medium text-brand-900 dark:text-brand-200">Default Spam Filter</h3>
                <p className="text-sm text-brand-700 dark:text-brand-400 mt-1">
                  Automatically hides certification training, self-guided tours, and
                  other low-quality events.
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer ml-4 flex-shrink-0">
                <input
                  type="checkbox"
                  checked={useDefaultFilters}
                  onChange={(e) => onToggleDefaultFilters(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 dark:bg-gray-700 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-brand-300 dark:peer-focus:ring-brand-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-500"></div>
              </label>
            </div>

            {useDefaultFilters && (
              <div className="mt-3">
                <button
                  onClick={() => setShowDefaultKeywords(!showDefaultKeywords)}
                  className="flex items-center gap-1 text-sm text-brand-700 dark:text-brand-400 hover:text-brand-900 dark:hover:text-brand-300 cursor-pointer"
                >
                  {showDefaultKeywords ? (
                    <ChevronUp size={16} />
                  ) : (
                    <ChevronDown size={16} />
                  )}
                  {showDefaultKeywords ? "Hide" : "View"} blocked keywords (
                  {defaultFilterKeywords.length})
                </button>

                {showDefaultKeywords && (
                  <div className="mt-2 max-h-40 overflow-y-auto p-2 bg-white dark:bg-gray-800 rounded border border-brand-200 dark:border-brand-800 text-xs text-gray-600 dark:text-gray-300">
                    <div className="flex flex-wrap gap-1">
                      {defaultFilterKeywords.map((kw, i) => (
                        <span
                          key={i}
                          className="inline-block bg-brand-100 dark:bg-brand-900/50 text-brand-800 dark:text-brand-300 px-2 py-0.5 rounded"
                        >
                          {kw}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Blocked Keywords */}
          <div>
            <ChipInput
              label="Blocked Keywords"
              values={blockedKeywords}
              onChange={onUpdateKeywords}
              placeholder="Type keyword and press Enter..."
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Events with these words in the title will be hidden
            </p>
          </div>

          {/* Blocked Hosts */}
          <div>
            <ChipInput
              label="Blocked Hosts"
              values={blockedHosts}
              onChange={onUpdateHosts}
              placeholder="Type host name and press Enter..."
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              All events from these organizers will be hidden
            </p>
          </div>

          {/* Hidden Events */}
          <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600 dark:text-gray-300">
                You have hidden <strong>{hiddenEvents.length}</strong> event pattern{hiddenEvents.length !== 1 ? 's' : ''}.
              </span>
              {hiddenEvents.length > 0 && (
                <button
                  onClick={() => onUpdateHiddenEvents([])}
                  className="flex items-center gap-2 text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 text-sm font-medium cursor-pointer"
                >
                  <Trash2 size={16} />
                  Clear All
                </button>
              )}
            </div>

            {hiddenEvents.length > 0 && (
              <div className="mt-3">
                <button
                  onClick={() => setShowHiddenEvents(!showHiddenEvents)}
                  className="flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 cursor-pointer"
                >
                  {showHiddenEvents ? (
                    <ChevronUp size={16} />
                  ) : (
                    <ChevronDown size={16} />
                  )}
                  {showHiddenEvents ? "Hide" : "View"} hidden events
                </button>

                {showHiddenEvents && (
                  <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
                    {hiddenEvents.map((event, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between p-2 bg-white dark:bg-gray-900 rounded border border-gray-200 dark:border-gray-700 text-xs"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-gray-700 dark:text-gray-200 truncate">
                            {event.title}
                          </div>
                          {event.organizer && (
                            <div className="text-gray-500 dark:text-gray-400 truncate">
                              by {event.organizer}
                            </div>
                          )}
                        </div>
                        <button
                          onClick={() => {
                            onUpdateHiddenEvents(
                              hiddenEvents.filter((_, idx) => idx !== i)
                            );
                          }}
                          className="ml-2 p-1 text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50 rounded cursor-pointer"
                          title="Unhide this event"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              Hidden events are matched by title + organizer, so recurring events stay hidden.
            </p>
          </div>
        </div>

        <div className="p-6 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-brand-600 text-white hover:bg-brand-700 rounded-lg transition-colors font-medium cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
