import Link from 'next/link';
import Image from 'next/image';

interface PublicCuratorCardProps {
  slug: string;
  displayName: string;
  title?: string | null;
  bio: string | null;
  avatarUrl: string | null;
  showProfilePicture: boolean;
  curationCount: number;
}

export default function PublicCuratorCard({
  slug,
  displayName,
  title,
  bio,
  avatarUrl,
  showProfilePicture,
  curationCount,
}: PublicCuratorCardProps) {
  return (
    <Link href={`/u/${slug}`}>
      <div className="flex items-start gap-4 p-4 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-brand-500 dark:hover:border-brand-400 hover:shadow-md transition-all cursor-pointer h-full">
        {showProfilePicture && avatarUrl ? (
          <div className="w-12 h-12 rounded-full overflow-hidden flex-shrink-0">
            <Image
              src={avatarUrl}
              alt={displayName}
              width={48}
              height={48}
              className="w-full h-full object-cover"
              unoptimized
            />
          </div>
        ) : (
          <div className="w-12 h-12 rounded-full bg-brand-100 dark:bg-brand-900 flex items-center justify-center flex-shrink-0">
            <span className="text-brand-600 dark:text-brand-400 font-semibold text-lg">
              {displayName.charAt(0).toUpperCase()}
            </span>
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-gray-900 dark:text-white truncate">{displayName}</h3>
          {title && <p className="text-xs text-gray-500 dark:text-gray-400">{title}</p>}
          <p className="text-xs text-gray-500/90 dark:text-gray-400/90 mb-1">
            {curationCount} curated event{curationCount !== 1 ? 's' : ''}
          </p>
          {bio && <p className="text-sm text-gray-600 dark:text-gray-300 line-clamp-2">{bio}</p>}
        </div>
      </div>
    </Link>
  );
}
