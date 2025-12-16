import Image from "next/image";

interface CuratorProfileCardProps {
  displayName: string;
  bio: string | null;
  curationCount: number;
  showProfilePicture?: boolean;
  avatarUrl?: string | null;
}

export default function CuratorProfileCard({
  displayName,
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
        ) : null}
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            {displayName}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {curationCount} curated event{curationCount !== 1 ? 's' : ''}
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
