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
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center p-6 border-b">
          <h2 className="text-xl font-bold text-gray-900">Feed Settings</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <X size={24} />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Default Filters Section */}
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <h3 className="font-medium text-amber-900">Default Spam Filter</h3>
                <p className="text-sm text-amber-700 mt-1">
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
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-amber-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-500"></div>
              </label>
            </div>

            {useDefaultFilters && (
              <div className="mt-3">
                <button
                  onClick={() => setShowDefaultKeywords(!showDefaultKeywords)}
                  className="flex items-center gap-1 text-sm text-amber-700 hover:text-amber-900 cursor-pointer"
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
                  <div className="mt-2 max-h-40 overflow-y-auto p-2 bg-white rounded border border-amber-200 text-xs text-gray-600">
                    <div className="flex flex-wrap gap-1">
                      {defaultFilterKeywords.map((kw, i) => (
                        <span
                          key={i}
                          className="inline-block bg-amber-100 text-amber-800 px-2 py-0.5 rounded"
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
            <p className="mt-1 text-xs text-gray-500">
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
            <p className="mt-1 text-xs text-gray-500">
              All events from these organizers will be hidden
            </p>
          </div>

          {/* Hidden Events */}
          <div className="p-4 bg-gray-50 rounded-lg">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">
                You have hidden <strong>{hiddenEvents.length}</strong> event pattern{hiddenEvents.length !== 1 ? 's' : ''}.
              </span>
              {hiddenEvents.length > 0 && (
                <button
                  onClick={() => onUpdateHiddenEvents([])}
                  className="flex items-center gap-2 text-red-600 hover:text-red-700 text-sm font-medium cursor-pointer"
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
                  className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 cursor-pointer"
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
                        className="flex items-center justify-between p-2 bg-white rounded border border-gray-200 text-xs"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-gray-700 truncate">
                            {event.title}
                          </div>
                          {event.organizer && (
                            <div className="text-gray-500 truncate">
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
                          className="ml-2 p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded cursor-pointer"
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
            <p className="mt-2 text-xs text-gray-500">
              Hidden events are matched by title + organizer, so recurring events stay hidden.
            </p>
          </div>
        </div>

        <div className="p-6 border-t bg-gray-50 flex justify-end">
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
