import Image from "next/image";
import { EventFeedSkeleton } from "@/components/EventCardSkeleton";

export default function Loading() {
  return (
    <main className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <Image
            src="/avlgo_banner_logo_v2.svg"
            alt="AVL GO"
            width={180}
            height={49}
            priority
          />
          <div className="text-sm text-gray-500 hidden sm:block">
            Aggregating all AVL events
          </div>
        </div>
      </header>

      <EventFeedSkeleton />

      <footer className="bg-white border-t border-gray-200 mt-12 py-8 text-center text-sm text-gray-500">
        <p>
          &copy; {new Date().getFullYear()} Asheville Event Feed. Not affiliated
          with AVL Today or Eventbrite.
        </p>
      </footer>
    </main>
  );
}
