'use client';

import { useState } from 'react';
import Image from 'next/image';
import VerifiedBadge from './VerifiedBadge';

interface CuratorProfileCardProps {
  displayName: string;
  title?: string | null;
  bio: string | null;
  curationCount: number;
  showProfilePicture?: boolean;
  avatarUrl?: string | null;
  isVerified?: boolean;
  showVerifyToggle?: boolean;
  curatorUserId?: string;
  onVerifyChange?: (verified: boolean) => void;
}

export default function CuratorProfileCard({
  displayName,
  title,
  bio,
  curationCount,
  showProfilePicture = false,
  avatarUrl,
  isVerified = false,
  showVerifyToggle = false,
  curatorUserId,
  onVerifyChange,
}: CuratorProfileCardProps) {
  const [verified, setVerified] = useState(isVerified);
  const [isToggling, setIsToggling] = useState(false);

  const handleToggleVerify = async () => {
    if (!curatorUserId || isToggling) return;

    setIsToggling(true);
    const newVerified = !verified;

    try {
      const response = await fetch('/api/admin/curator/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ curatorUserId, verified: newVerified }),
      });

      if (response.ok) {
        setVerified(newVerified);
        onVerifyChange?.(newVerified);
      } else {
        console.error('Failed to toggle verification');
      }
    } catch (error) {
      console.error('Error toggling verification:', error);
    } finally {
      setIsToggling(false);
    }
  };

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl shadow-lg border border-gray-200 dark:border-gray-800 p-6 mb-8">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex items-center gap-4">
          {showProfilePicture && avatarUrl ? (
            <div className="w-16 h-16 rounded-full overflow-hidden flex-shrink-0">
              <Image
                src={avatarUrl}
                alt={displayName}
                width={64}
                height={64}
                className="w-full h-full object-cover"
                unoptimized
              />
            </div>
          ) : (
            <div className="w-16 h-16 rounded-full bg-brand-100 dark:bg-brand-900 flex items-center justify-center flex-shrink-0">
              <span className="text-brand-600 dark:text-brand-400 font-semibold text-xl">
                {displayName.charAt(0).toUpperCase()}
              </span>
            </div>
          )}
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{displayName}</h1>
              {verified && <VerifiedBadge size={22} />}
            </div>
            {title && <p className="text-sm text-gray-500 dark:text-gray-400">{title}</p>}
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {curationCount} curated event{curationCount !== 1 ? 's' : ''}
            </p>
          </div>
        </div>

        {showVerifyToggle && curatorUserId && (
          <label
            className={`flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg border transition-colors cursor-pointer ${
              verified
                ? 'bg-brand-50 dark:bg-brand-900/30 border-brand-300 dark:border-brand-700 text-brand-700 dark:text-brand-300'
                : 'bg-gray-50 dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300'
            } ${isToggling ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-100 dark:hover:bg-gray-700'}`}
          >
            <input
              type="checkbox"
              checked={verified}
              onChange={() => void handleToggleVerify()}
              disabled={isToggling}
              className="w-4 h-4 accent-brand-500 cursor-pointer"
            />
            <span>Verified</span>
          </label>
        )}
      </div>

      {bio && <p className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{bio}</p>}
    </div>
  );
}
