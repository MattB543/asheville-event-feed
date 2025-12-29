"use client";

import { useState, useEffect } from "react";
import { Copy, Check, ExternalLink } from "lucide-react";
import { useToast } from "@/components/ui/Toast";

interface CuratorProfile {
  userId: string;
  slug: string;
  displayName: string;
  title: string | null;
  bio: string | null;
  isPublic: boolean;
  showProfilePicture: boolean;
  avatarUrl: string | null;
}

interface CuratorProfileSettingsProps {
  userId: string;
  email: string;
  avatarUrl: string | null;
}

export default function CuratorProfileSettings({
  email,
  avatarUrl,
}: CuratorProfileSettingsProps) {
  const [profile, setProfile] = useState<CuratorProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const { showToast } = useToast();

  // Form state
  const [displayName, setDisplayName] = useState("");
  const [title, setTitle] = useState("");
  const [bio, setBio] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [showProfilePicture, setShowProfilePicture] = useState(false);

  // Fetch existing profile on mount
  useEffect(() => {
    fetch("/api/curator/settings")
      .then((res) => res.json())
      .then((data) => {
        if (data.profile) {
          setProfile(data.profile);
          setDisplayName(data.profile.displayName);
          setTitle(data.profile.title || "");
          setBio(data.profile.bio || "");
          setIsPublic(data.profile.isPublic);
          setShowProfilePicture(data.profile.showProfilePicture || false);
        } else {
          // Default display name from email
          setDisplayName(email.split("@")[0]);
        }
        setIsLoading(false);
      })
      .catch((err) => {
        console.error("Failed to load profile:", err);
        setDisplayName(email.split("@")[0]);
        setIsLoading(false);
      });
  }, [email]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const trimmedTitle = title.trim();
      const res = await fetch("/api/curator/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName,
          title: trimmedTitle ? trimmedTitle : null,
          bio,
          isPublic,
          showProfilePicture,
          avatarUrl: showProfilePicture ? avatarUrl : null,
        }),
      });

      const data = await res.json();
      if (data.profile) {
        setProfile(data.profile);
        showToast("Profile settings saved!", "success");
      } else if (data.error) {
        showToast(data.error, "error");
      }
    } catch (err) {
      console.error("Failed to save:", err);
      showToast("Failed to save settings", "error");
    }
    setIsSaving(false);
  };

  const copyProfileUrl = () => {
    if (profile?.slug) {
      navigator.clipboard.writeText(
        `${window.location.origin}/u/${profile.slug}`
      );
      setCopied(true);
      showToast("Profile URL copied!", "success");
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (isLoading) {
    return (
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-lg border border-gray-200 dark:border-gray-800 p-6">
        <div className="animate-pulse">
          <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-1/3 mb-4"></div>
          <div className="h-10 bg-gray-200 dark:bg-gray-700 rounded mb-4"></div>
          <div className="h-20 bg-gray-200 dark:bg-gray-700 rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl shadow-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
      <div className="p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-6">
          Curator Profile
        </h2>

        {/* Visibility Toggle */}
        <div className="flex items-center justify-between mb-6 pb-6 border-b border-gray-200 dark:border-gray-700">
          <div>
            <label className="font-medium text-gray-900 dark:text-white">
              Public Profile
            </label>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              When enabled, others can see your curated events
            </p>
          </div>
          <button
            onClick={() => setIsPublic(!isPublic)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer ${
              isPublic ? "bg-brand-600" : "bg-gray-300 dark:bg-gray-600"
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                isPublic ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        </div>

        {/* Show Profile Picture Toggle */}
        <div className="flex items-center justify-between mb-6 pb-6 border-b border-gray-200 dark:border-gray-700">
          <div>
            <label className="font-medium text-gray-900 dark:text-white">
              Show Profile Picture
            </label>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              {avatarUrl
                ? "Display your account profile picture on your public page"
                : "No profile picture available from your account"}
            </p>
          </div>
          <button
            onClick={() => avatarUrl && setShowProfilePicture(!showProfilePicture)}
            disabled={!avatarUrl}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer ${
              !avatarUrl
                ? "bg-gray-200 dark:bg-gray-700 cursor-not-allowed"
                : showProfilePicture
                ? "bg-brand-600"
                : "bg-gray-300 dark:bg-gray-600"
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                showProfilePicture ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        </div>

        {/* Profile URL (read-only) */}
        {profile?.slug && (
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Your profile URL
            </label>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-sm bg-gray-100 dark:bg-gray-800 px-3 py-2 rounded-lg text-gray-700 dark:text-gray-300 truncate">
                {typeof window !== "undefined" ? window.location.origin : ""}
                /u/{profile.slug}
              </code>
              <button
                onClick={copyProfileUrl}
                className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors cursor-pointer"
                title="Copy URL"
              >
                {copied ? (
                  <Check size={18} className="text-green-500" />
                ) : (
                  <Copy size={18} />
                )}
              </button>
              {isPublic && (
                <a
                  href={`/u/${profile.slug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2 text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300 transition-colors cursor-pointer"
                  title="View profile"
                >
                  <ExternalLink size={18} />
                </a>
              )}
            </div>
          </div>
        )}

        {/* Display Name */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Display Name
          </label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value.slice(0, 50))}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500"
            placeholder="First name, full name, whatever you want shown"
            maxLength={50}
          />
        </div>

        {/* Title / Role */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Title / Role / Job (optional)
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value.slice(0, 80))}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500"
            placeholder="Founder of XYZ"
            maxLength={80}
          />
        </div>

        {/* Bio */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Bio (optional)
          </label>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value.slice(0, 500))}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
            rows={4}
            placeholder="Tell others about your event taste..."
            maxLength={500}
          />
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 text-right">
            {bio.length}/500
          </p>
        </div>

        {/* Save Button */}
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="w-full px-4 py-2 text-sm font-medium text-white bg-brand-600 rounded-lg hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
        >
          {isSaving ? "Saving..." : "Save Changes"}
        </button>
      </div>
    </div>
  );
}
