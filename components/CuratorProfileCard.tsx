import Image from "next/image";

interface CuratorProfileCardProps {
  displayName: string;
  title?: string | null;
  bio: string | null;
  curationCount: number;
  showProfilePicture?: boolean;
  avatarUrl?: string | null;
}

export default function CuratorProfileCard({
  displayName,
  title,
  bio,
  curationCount,
  showProfilePicture = false,
  avatarUrl,
}: CuratorProfileCardProps) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl shadow-lg border border-gray-200 dark:border-gray-800 p-6 mb-8">
      <div className="flex items-center gap-4 mb-4">
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
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            {displayName}
          </h1>
          {title && (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {title}
            </p>
          )}
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {curationCount} curated event{curationCount !== 1 ? "s" : ""}
          </p>
        </div>
      </div>

      {bio && (
        <p className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
          {bio}
        </p>
      )}
    </div>
  );
}
