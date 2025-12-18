import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { ArrowLeft, Mail, Shield, User } from "lucide-react";
import CuratorProfileSettings from "@/components/CuratorProfileSettings";
import EmailDigestSettings from "@/components/EmailDigestSettings";
import { db } from "@/lib/db";
import { events } from "@/lib/db/schema";
import { sql } from "drizzle-orm";

export default async function ProfilePage() {
  const supabase = await createClient();

  // Server-side protection - always use getUser() not getSession()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    redirect("/login");
  }

  // Extract user metadata
  const metadata = user.user_metadata || {};
  const email = user.email || "No email";
  const fullName = metadata.full_name || metadata.name || null;
  const avatarUrl = metadata.avatar_url || metadata.picture || null;
  const provider = user.app_metadata?.provider || "email";

  // Fetch available tags for the email digest settings
  const tagResults = await db
    .select({
      tags: events.tags,
    })
    .from(events)
    .where(sql`${events.tags} IS NOT NULL AND array_length(${events.tags}, 1) > 0`)
    .limit(500);

  // Count tag occurrences and get top tags
  const tagCounts = new Map<string, number>();
  tagResults.forEach((row) => {
    row.tags?.forEach((tag) => {
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    });
  });
  const availableTags = Array.from(tagCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([tag]) => tag);

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Back link */}
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to events
        </Link>

        {/* Profile Card */}
        <div className="bg-white dark:bg-gray-900 rounded-xl shadow-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
          {/* Header with avatar */}
          <div className="bg-gradient-to-r from-brand-600 to-brand-700 px-6 py-8">
            <div className="flex items-center gap-4">
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={avatarUrl}
                  alt={fullName || "Profile"}
                  className="w-20 h-20 rounded-full border-4 border-white shadow-lg"
                />
              ) : (
                <div className="w-20 h-20 rounded-full border-4 border-white shadow-lg bg-brand-500 flex items-center justify-center">
                  <User className="w-10 h-10 text-white" />
                </div>
              )}
              <div>
                <h1 className="text-2xl font-bold text-white">
                  {fullName || "AVL GO User"}
                </h1>
                <p className="text-brand-100">{email}</p>
              </div>
            </div>
          </div>

          {/* Profile details */}
          <div className="p-6 space-y-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              Account Details
            </h2>

            <div className="space-y-4">
              {/* Email */}
              <div className="flex items-start gap-3">
                <div className="p-2 bg-gray-100 dark:bg-gray-800 rounded-lg">
                  <Mail className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                </div>
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Email
                  </p>
                  <p className="text-gray-900 dark:text-white">{email}</p>
                </div>
              </div>

              {/* Full Name (if available) */}
              {fullName && (
                <div className="flex items-start gap-3">
                  <div className="p-2 bg-gray-100 dark:bg-gray-800 rounded-lg">
                    <User className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Name
                    </p>
                    <p className="text-gray-900 dark:text-white">{fullName}</p>
                  </div>
                </div>
              )}

              {/* Sign-in method */}
              <div className="flex items-start gap-3">
                <div className="p-2 bg-gray-100 dark:bg-gray-800 rounded-lg">
                  <Shield className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                </div>
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Sign-in Method
                  </p>
                  <p className="text-gray-900 dark:text-white capitalize">
                    {provider === "google" ? "Google" : "Magic Link (Email)"}
                  </p>
                </div>
              </div>
            </div>

            {/* Raw metadata for debugging (dev only) */}
            {process.env.NODE_ENV === "development" && (
              <>
                <hr className="border-gray-200 dark:border-gray-700" />
                <details className="group">
                  <summary className="cursor-pointer text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300">
                    View raw account data
                  </summary>
                  <div className="mt-3 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg overflow-x-auto">
                    <pre className="text-xs text-gray-600 dark:text-gray-300 whitespace-pre-wrap">
                      {JSON.stringify(
                        {
                          id: user.id,
                          email: user.email,
                          email_confirmed_at: user.email_confirmed_at,
                          created_at: user.created_at,
                          last_sign_in_at: user.last_sign_in_at,
                          app_metadata: user.app_metadata,
                          user_metadata: user.user_metadata,
                        },
                        null,
                        2
                      )}
                    </pre>
                  </div>
                </details>
              </>
            )}
          </div>
        </div>

        {/* Email Digest Settings */}
        <div className="mt-8">
          <EmailDigestSettings
            userId={user.id}
            email={email}
            availableTags={availableTags}
          />
        </div>

        {/* Curator Profile Settings */}
        <div className="mt-8">
          <CuratorProfileSettings userId={user.id} email={email} avatarUrl={avatarUrl} />
        </div>
      </div>
    </main>
  );
}
