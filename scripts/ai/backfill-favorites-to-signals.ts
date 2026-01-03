/**
 * Backfill script to convert existing favorited events into positive signals.
 *
 * This script reads all users' favoritedEventIds and creates corresponding
 * positive signals in their positiveSignals array.
 *
 * Run with: npx tsx scripts/ai/backfill-favorites-to-signals.ts
 */

import { db } from '@/lib/db';
import { userPreferences } from '@/lib/db/schema';
import { sql } from 'drizzle-orm';

interface PositiveSignal {
  eventId: string;
  signalType: 'favorite' | 'calendar' | 'share' | 'viewSource';
  timestamp: string;
  active: boolean;
}

async function backfillFavoritesToSignals() {
  console.log('Starting backfill of favorites to signals...\n');

  // Fetch all user preferences with favorited event IDs
  const allPrefs = await db
    .select({
      userId: userPreferences.userId,
      favoritedEventIds: userPreferences.favoritedEventIds,
      positiveSignals: userPreferences.positiveSignals,
    })
    .from(userPreferences);

  console.log(`Found ${allPrefs.length} users with preferences\n`);

  let totalSignalsAdded = 0;
  let usersUpdated = 0;

  for (const prefs of allPrefs) {
    const favoritedIds = prefs.favoritedEventIds ?? [];
    const existingSignals = (prefs.positiveSignals as PositiveSignal[]) ?? [];

    if (favoritedIds.length === 0) {
      continue;
    }

    // Find favorited IDs that don't already have a signal
    const existingFavoriteEventIds = new Set(
      existingSignals.filter((s) => s.signalType === 'favorite').map((s) => s.eventId)
    );

    const newFavoriteIds = favoritedIds.filter((id) => !existingFavoriteEventIds.has(id));

    if (newFavoriteIds.length === 0) {
      console.log(
        `User ${prefs.userId}: All ${favoritedIds.length} favorites already have signals`
      );
      continue;
    }

    // Create new signals for missing favorites
    // Use a backdated timestamp (1 day ago) so new favorites appear more recent
    const backdatedTimestamp = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const newSignals: PositiveSignal[] = newFavoriteIds.map((eventId) => ({
      eventId,
      signalType: 'favorite' as const,
      timestamp: backdatedTimestamp,
      active: true,
    }));

    const updatedSignals = [...existingSignals, ...newSignals];

    // Update the user's preferences with the new signals
    await db.execute(sql`
      UPDATE user_preferences
      SET
        positive_signals = ${JSON.stringify(updatedSignals)}::jsonb,
        positive_centroid = NULL,
        centroid_updated_at = NULL,
        updated_at = NOW()
      WHERE user_id = ${prefs.userId}
    `);

    console.log(
      `User ${prefs.userId}: Added ${newSignals.length} signals (had ${existingSignals.length} existing)`
    );
    totalSignalsAdded += newSignals.length;
    usersUpdated++;
  }

  console.log(`\n✅ Backfill complete!`);
  console.log(`   Users updated: ${usersUpdated}`);
  console.log(`   Total signals added: ${totalSignalsAdded}`);
}

// Run the backfill
backfillFavoritesToSignals()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Backfill failed:', error);
    process.exit(1);
  });
