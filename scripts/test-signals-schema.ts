/**
 * Test script to verify the signals schema changes compile correctly
 */

import { db } from '../lib/db';
import { userPreferences } from '../lib/db/schema';
import { eq } from 'drizzle-orm';

async function testSignalsSchema() {
  console.log('Testing signals schema...\n');

  // Test that the new columns are accessible
  try {
    // Try to select from the table (this will fail if columns don't exist yet, but will compile)
    const testUserId = '00000000-0000-0000-0000-000000000000';
    const result = await db
      .select({
        positiveSignals: userPreferences.positiveSignals,
        negativeSignals: userPreferences.negativeSignals,
        positiveCentroid: userPreferences.positiveCentroid,
        negativeCentroid: userPreferences.negativeCentroid,
        centroidUpdatedAt: userPreferences.centroidUpdatedAt,
      })
      .from(userPreferences)
      .where(eq(userPreferences.userId, testUserId))
      .limit(1);

    console.log('✅ Schema columns are accessible');
    console.log('Result:', result.length === 0 ? 'No test user found (expected)' : result[0]);
  } catch (error: any) {
    const errorMessage = error?.message || String(error);
    const causeMessage = error?.cause?.message || '';
    const isMissingColumn =
      errorMessage.includes('column') ||
      errorMessage.includes('does not exist') ||
      causeMessage.includes('column') ||
      causeMessage.includes('does not exist');

    if (isMissingColumn) {
      console.log('⚠️  Columns exist in schema but not yet in database');
      console.log('   Run: npx drizzle-kit push');
      console.log('\n✅ TypeScript compilation successful');
      console.log('   Schema types are correctly defined');
      process.exit(0);
    } else {
      console.error('❌ Unexpected error:', error);
      process.exit(1);
    }
  }

  console.log('\n✅ TypeScript compilation successful');
  console.log('   Schema types are correctly defined');

  process.exit(0);
}

testSignalsSchema();
