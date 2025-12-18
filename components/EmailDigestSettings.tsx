"use client";

import { useState, useEffect } from "react";
import { Mail, Bell, BellOff, Calendar, Tag, Loader2 } from "lucide-react";

type DigestFrequency = "none" | "daily" | "weekly";

interface EmailDigestSettingsProps {
  userId: string;
  email: string;
  availableTags?: string[];
}

export default function EmailDigestSettings({
  userId,
  email,
  availableTags = [],
}: EmailDigestSettingsProps) {
  const [frequency, setFrequency] = useState<DigestFrequency>("none");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Load current settings
  useEffect(() => {
    async function loadSettings() {
      try {
        const res = await fetch("/api/email-digest/settings");
        if (res.ok) {
          const data = await res.json();
          setFrequency(data.frequency || "none");
          setSelectedTags(data.tags || []);
        }
      } catch (error) {
        console.error("Failed to load email settings:", error);
      } finally {
        setIsLoading(false);
      }
    }
    loadSettings();
  }, []);

  // Save settings
  const handleSave = async () => {
    setIsSaving(true);
    setMessage(null);

    try {
      const res = await fetch("/api/email-digest/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          frequency,
          tags: selectedTags,
        }),
      });

      if (res.ok) {
        setMessage({
          type: "success",
          text:
            frequency === "none"
              ? "Email notifications disabled"
              : `You'll receive ${frequency} event digests at ${email}`,
        });
      } else {
        throw new Error("Failed to save");
      }
    } catch (error) {
      setMessage({ type: "error", text: "Failed to save settings. Please try again." });
      console.error("Failed to save email settings:", error);
    } finally {
      setIsSaving(false);
    }
  };

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  if (isLoading) {
    return (
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-lg border border-gray-200 dark:border-gray-800 p-6">
        <div className="flex items-center gap-3">
          <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
          <span className="text-gray-500 dark:text-gray-400">Loading email settings...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl shadow-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-800">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-brand-100 dark:bg-brand-900/30 rounded-lg">
            <Mail className="w-5 h-5 text-brand-600 dark:text-brand-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              Email Notifications
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Get event updates delivered to {email}
            </p>
          </div>
        </div>
      </div>

      <div className="p-6 space-y-6">
        {/* Frequency Selection */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
            How often would you like to receive event digests?
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <FrequencyOption
              value="none"
              current={frequency}
              onChange={setFrequency}
              icon={<BellOff className="w-5 h-5" />}
              label="None"
              description="No emails"
            />
            <FrequencyOption
              value="daily"
              current={frequency}
              onChange={setFrequency}
              icon={<Bell className="w-5 h-5" />}
              label="Daily"
              description="Every morning"
            />
            <FrequencyOption
              value="weekly"
              current={frequency}
              onChange={setFrequency}
              icon={<Calendar className="w-5 h-5" />}
              label="Weekly"
              description="Every Monday"
            />
          </div>
        </div>

        {/* Tag Filters (only show if subscribed) */}
        {frequency !== "none" && availableTags.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              <Tag className="w-4 h-4 inline-block mr-1" />
              Filter by tags (optional)
            </label>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
              Only receive events with specific tags. Leave empty for all events.
            </p>
            <div className="flex flex-wrap gap-2">
              {availableTags.slice(0, 20).map((tag) => (
                <button
                  key={tag}
                  onClick={() => toggleTag(tag)}
                  className={`px-3 py-1.5 text-sm rounded-full border transition-colors cursor-pointer ${
                    selectedTags.includes(tag)
                      ? "bg-brand-600 text-white border-brand-600"
                      : "bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:border-brand-500"
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>
            {selectedTags.length > 0 && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                {selectedTags.length} tag{selectedTags.length === 1 ? "" : "s"} selected
              </p>
            )}
          </div>
        )}

        {/* Info Box */}
        {frequency !== "none" && (
          <div className="bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-800 rounded-lg p-4">
            <p className="text-sm text-brand-800 dark:text-brand-200">
              <strong>What you&apos;ll receive:</strong> A curated list of{" "}
              {frequency === "daily" ? "new events added since your last digest" : "upcoming events for the week"}
              {selectedTags.length > 0
                ? `, filtered to: ${selectedTags.join(", ")}`
                : ", matching your blocked hosts and keywords filters"}
              .
            </p>
          </div>
        )}

        {/* Message */}
        {message && (
          <div
            className={`p-4 rounded-lg ${
              message.type === "success"
                ? "bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200"
                : "bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200"
            }`}
          >
            {message.text}
          </div>
        )}

        {/* Save Button */}
        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-6 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 cursor-pointer"
          >
            {isSaving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Saving...
              </>
            ) : (
              "Save Preferences"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

interface FrequencyOptionProps {
  value: DigestFrequency;
  current: DigestFrequency;
  onChange: (value: DigestFrequency) => void;
  icon: React.ReactNode;
  label: string;
  description: string;
}

function FrequencyOption({
  value,
  current,
  onChange,
  icon,
  label,
  description,
}: FrequencyOptionProps) {
  const isSelected = current === value;

  return (
    <button
      onClick={() => onChange(value)}
      className={`flex flex-col items-center p-4 rounded-lg border-2 transition-all cursor-pointer ${
        isSelected
          ? "border-brand-600 bg-brand-50 dark:bg-brand-900/20"
          : "border-gray-200 dark:border-gray-700 hover:border-brand-300 dark:hover:border-brand-700"
      }`}
    >
      <div
        className={`mb-2 ${
          isSelected
            ? "text-brand-600 dark:text-brand-400"
            : "text-gray-400 dark:text-gray-500"
        }`}
      >
        {icon}
      </div>
      <span
        className={`font-medium ${
          isSelected
            ? "text-brand-600 dark:text-brand-400"
            : "text-gray-700 dark:text-gray-300"
        }`}
      >
        {label}
      </span>
      <span className="text-xs text-gray-500 dark:text-gray-400">{description}</span>
    </button>
  );
}

