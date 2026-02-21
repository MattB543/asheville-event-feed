import 'dotenv/config';
import { db } from '../lib/db';
import { events } from '../lib/db/schema';
import { sql } from 'drizzle-orm';

// ============================================================================
// Score corrections based on reviewer analysis of Top 50 lists
// Safe to run multiple times (idempotent — sets absolute values)
// ============================================================================

interface OverallCorrection {
  label: string;
  titlePattern: string;
  /** Additional conditions (e.g., location or title contains) */
  extraWhere?: ReturnType<typeof sql>;
  scoreRarity: number;
  scoreUnique: number;
  scoreMagnitude: number;
}

interface DimensionCorrection {
  label: string;
  titlePattern: string;
  extraWhere?: ReturnType<typeof sql>;
  field: 'scoreAshevilleWeird' | 'scoreSocial';
  value: number;
}

// ---------------------------------------------------------------------------
// OVERALL LIST CORRECTIONS (rarity + unique + magnitude -> score)
// ---------------------------------------------------------------------------
const overallCorrections: OverallCorrection[] = [
  {
    label: 'Rock, Tumble, and Roll',
    titlePattern: '%Rock, Tumble, and Roll%',
    scoreRarity: 7,
    scoreUnique: 5,
    scoreMagnitude: 6,
  },
  {
    label: 'SoCon Business Leader Forum (Roy Williams)',
    titlePattern: '%SoCon Business Leader Forum%',
    scoreRarity: 7,
    scoreUnique: 5,
    scoreMagnitude: 7,
  },
  {
    label: "SOCON Basketball Tournament: Men's Semi Final",
    titlePattern: '%SOCON Basketball Tournament%Semi Final%',
    scoreRarity: 6,
    scoreUnique: 5,
    scoreMagnitude: 8,
  },
  {
    label: 'Trauma to Transformation (Tonier Cain)',
    titlePattern: '%Trauma to Transformation%',
    scoreRarity: 6,
    scoreUnique: 4,
    scoreMagnitude: 5,
  },
  {
    label: 'The Star Cheerleading Competition (ALL)',
    titlePattern: '%Star Cheerleading Competition%',
    scoreRarity: 5,
    scoreUnique: 4,
    scoreMagnitude: 7,
  },
  {
    label: 'WNC Resilience Hub Network Summit',
    titlePattern: '%WNC Resilience Hub Network Summit%',
    scoreRarity: 6,
    scoreUnique: 4,
    scoreMagnitude: 5,
  },
  {
    label: 'An Evening of Gratitude, Friendship and Global Vision',
    titlePattern: '%Evening of Gratitude%Friendship%Global Vision%',
    scoreRarity: 7,
    scoreUnique: 3,
    scoreMagnitude: 4,
  },
  {
    label: 'SOCON Basketball Tournament Championship',
    titlePattern: '%SOCON Basketball Tournament%Championship%',
    scoreRarity: 7,
    scoreUnique: 7,
    scoreMagnitude: 9,
  },
  {
    label: 'Asheville Symphony ALT ASO at Orange Peel',
    titlePattern: '%Asheville Symphony%',
    extraWhere: sql`(${events.title} ILIKE '%ALT ASO%' AND (${events.title} ILIKE '%Orange Peel%' OR ${events.location} ILIKE '%Orange Peel%'))`,
    scoreRarity: 7,
    scoreUnique: 9,
    scoreMagnitude: 8,
  },
];

// ---------------------------------------------------------------------------
// WEIRD LIST CORRECTIONS (scoreAshevilleWeird)
// ---------------------------------------------------------------------------
const weirdCorrections: DimensionCorrection[] = [
  {
    label: 'Black Cat Tales',
    titlePattern: '%Black Cat Tales%',
    field: 'scoreAshevilleWeird',
    value: 6,
  },
  {
    label: 'Find Your Familiar (cat adoption)',
    titlePattern: '%Find Your Familiar%',
    field: 'scoreAshevilleWeird',
    value: 5,
  },
  {
    label: 'Coolship Experience',
    titlePattern: '%Coolship Experience%',
    field: 'scoreAshevilleWeird',
    value: 5,
  },
  { label: 'Pie Bake-Off', titlePattern: '%Pie Bake-Off%', field: 'scoreAshevilleWeird', value: 4 },
  {
    label: 'First Aid Kits for Herbalists',
    titlePattern: '%First Aid Kits for Herbalists%',
    field: 'scoreAshevilleWeird',
    value: 5,
  },
  {
    label: 'Coloring with Cats',
    titlePattern: '%Coloring with Cats%',
    field: 'scoreAshevilleWeird',
    value: 5,
  },
  {
    label: 'National Arts and Crafts Conference (Grove Park Inn) - weird',
    titlePattern: '%National Arts and Crafts Conference%',
    field: 'scoreAshevilleWeird',
    value: 3,
  },
  {
    label: 'Lotus at Orange Peel',
    titlePattern: '%Lotus%',
    extraWhere: sql`(${events.location} ILIKE '%Orange Peel%' OR ${events.title} ILIKE '%Orange Peel%')`,
    field: 'scoreAshevilleWeird',
    value: 5,
  },
  { label: 'pheel & Chez', titlePattern: '%pheel%Chez%', field: 'scoreAshevilleWeird', value: 5 },
  {
    label: 'ABCD platonic cuddle',
    titlePattern: '%ABCD%',
    extraWhere: sql`${events.title} ILIKE '%platonic cuddle%'`,
    field: 'scoreAshevilleWeird',
    value: 9,
  },
  {
    label: 'Red Dress Run',
    titlePattern: '%Red Dress Run%',
    field: 'scoreAshevilleWeird',
    value: 9,
  },
  {
    label: 'Comedy Queens (drag brunch)',
    titlePattern: '%Comedy Queens%',
    field: 'scoreAshevilleWeird',
    value: 8,
  },
  {
    label: 'Last Light of Tullowyth',
    titlePattern: '%Last Light of Tullowyth%',
    field: 'scoreAshevilleWeird',
    value: 9,
  },
  {
    label: 'Spring Witch (mini day retreat)',
    titlePattern: '%Spring Witch%',
    field: 'scoreAshevilleWeird',
    value: 9,
  },
];

// ---------------------------------------------------------------------------
// SOCIAL LIST CORRECTIONS (scoreSocial)
// ---------------------------------------------------------------------------
const socialCorrections: DimensionCorrection[] = [
  { label: 'Blind Date Live', titlePattern: '%Blind Date Live%', field: 'scoreSocial', value: 7 },
  {
    label: 'COME TO THE TABLE OF THE EVER AFTER',
    titlePattern: '%COME TO THE TABLE OF THE EVER AFTER%',
    field: 'scoreSocial',
    value: 7,
  },
  { label: 'Bike Love Gala', titlePattern: '%Bike Love Gala%', field: 'scoreSocial', value: 7 },
  {
    label: 'Red Tent Workshop',
    titlePattern: '%Red Tent Workshop%',
    field: 'scoreSocial',
    value: 7,
  },
  {
    label: 'Spirituality of Depolarization',
    titlePattern: '%Spirituality of Depolarization%',
    field: 'scoreSocial',
    value: 7,
  },
  { label: 'IBN Biz Lunch (ALL)', titlePattern: '%IBN Biz Lunch%', field: 'scoreSocial', value: 7 },
  {
    label: 'Stroke Support Group',
    titlePattern: '%Stroke Support Group%',
    field: 'scoreSocial',
    value: 5,
  },
  {
    label: 'Virtual Networking Group / Business Virtual Networking',
    titlePattern: '%Virtual Networking%',
    field: 'scoreSocial',
    value: 5,
  },
  {
    label: 'Dementia Partners Support Group',
    titlePattern: '%Dementia Partners Support Group%',
    field: 'scoreSocial',
    value: 5,
  },
  {
    label: 'Nicotine Anonymous',
    titlePattern: '%Nicotine Anonymous%',
    field: 'scoreSocial',
    value: 5,
  },
  {
    label: 'National Arts and Crafts Conference (Grove Park Inn) - social',
    titlePattern: '%National Arts and Crafts Conference%',
    field: 'scoreSocial',
    value: 9,
  },
  {
    label: 'Asheville Game Design Festival',
    titlePattern: '%Asheville Game Design Festival%',
    field: 'scoreSocial',
    value: 9,
  },
  {
    label: 'Wild Asheville Community Chorus',
    titlePattern: '%Songs of harmony%hope%',
    field: 'scoreSocial',
    value: 10,
  },
  { label: 'Chai Pani Holi', titlePattern: '%Chai Pani Holi%', field: 'scoreSocial', value: 9 },
  {
    label: 'Friday the 13th Fusion Dance',
    titlePattern: '%Friday the 13th Fusion Dance%',
    field: 'scoreSocial',
    value: 9,
  },
];

// ============================================================================
// Main
// ============================================================================

async function main() {
  let updated = 0;
  let notFound = 0;
  let errors = 0;

  console.log('=== Applying Score Corrections ===\n');

  // -----------------------------------------------------------------------
  // 1. OVERALL corrections (rarity, unique, magnitude, score)
  // -----------------------------------------------------------------------
  console.log('--- OVERALL LIST CORRECTIONS ---\n');

  for (const c of overallCorrections) {
    try {
      const whereConditions = c.extraWhere
        ? sql`${events.title} ILIKE ${c.titlePattern} AND ${c.extraWhere}`
        : sql`${events.title} ILIKE ${c.titlePattern}`;

      // Find matching events
      const matches = await db
        .select({
          id: events.id,
          title: events.title,
          location: events.location,
          scoreRarity: events.scoreRarity,
          scoreUnique: events.scoreUnique,
          scoreMagnitude: events.scoreMagnitude,
          score: events.score,
        })
        .from(events)
        .where(whereConditions);

      if (matches.length === 0) {
        console.log(`  [NOT FOUND] ${c.label}`);
        console.log(`    Pattern: ${c.titlePattern}`);
        notFound++;
        continue;
      }

      const newScore = c.scoreRarity + c.scoreUnique + c.scoreMagnitude;

      for (const m of matches) {
        console.log(`  [UPDATING] ${c.label}`);
        console.log(`    Title: ${m.title}`);
        console.log(
          `    Before: rarity=${m.scoreRarity}, unique=${m.scoreUnique}, magnitude=${m.scoreMagnitude}, total=${m.score}`
        );
        console.log(
          `    After:  rarity=${c.scoreRarity}, unique=${c.scoreUnique}, magnitude=${c.scoreMagnitude}, total=${newScore}`
        );

        await db
          .update(events)
          .set({
            scoreRarity: c.scoreRarity,
            scoreUnique: c.scoreUnique,
            scoreMagnitude: c.scoreMagnitude,
            score: newScore,
            updatedAt: new Date(),
          })
          .where(sql`${events.id} = ${m.id}`);

        updated++;
      }
    } catch (err) {
      console.error(`  [ERROR] ${c.label}:`, err);
      errors++;
    }
  }

  // -----------------------------------------------------------------------
  // 2. WEIRD corrections (scoreAshevilleWeird)
  // -----------------------------------------------------------------------
  console.log('\n--- WEIRD LIST CORRECTIONS ---\n');

  for (const c of weirdCorrections) {
    try {
      const whereConditions = c.extraWhere
        ? sql`${events.title} ILIKE ${c.titlePattern} AND ${c.extraWhere}`
        : sql`${events.title} ILIKE ${c.titlePattern}`;

      const matches = await db
        .select({
          id: events.id,
          title: events.title,
          location: events.location,
          scoreAshevilleWeird: events.scoreAshevilleWeird,
        })
        .from(events)
        .where(whereConditions);

      if (matches.length === 0) {
        console.log(`  [NOT FOUND] ${c.label}`);
        console.log(`    Pattern: ${c.titlePattern}`);
        notFound++;
        continue;
      }

      for (const m of matches) {
        console.log(`  [UPDATING] ${c.label}`);
        console.log(`    Title: ${m.title}`);
        console.log(`    Before: weird=${m.scoreAshevilleWeird}`);
        console.log(`    After:  weird=${c.value}`);

        await db
          .update(events)
          .set({
            scoreAshevilleWeird: c.value,
            updatedAt: new Date(),
          })
          .where(sql`${events.id} = ${m.id}`);

        updated++;
      }
    } catch (err) {
      console.error(`  [ERROR] ${c.label}:`, err);
      errors++;
    }
  }

  // -----------------------------------------------------------------------
  // 3. SOCIAL corrections (scoreSocial)
  // -----------------------------------------------------------------------
  console.log('\n--- SOCIAL LIST CORRECTIONS ---\n');

  for (const c of socialCorrections) {
    try {
      const whereConditions = c.extraWhere
        ? sql`${events.title} ILIKE ${c.titlePattern} AND ${c.extraWhere}`
        : sql`${events.title} ILIKE ${c.titlePattern}`;

      const matches = await db
        .select({
          id: events.id,
          title: events.title,
          location: events.location,
          scoreSocial: events.scoreSocial,
        })
        .from(events)
        .where(whereConditions);

      if (matches.length === 0) {
        console.log(`  [NOT FOUND] ${c.label}`);
        console.log(`    Pattern: ${c.titlePattern}`);
        notFound++;
        continue;
      }

      for (const m of matches) {
        console.log(`  [UPDATING] ${c.label}`);
        console.log(`    Title: ${m.title}`);
        console.log(`    Before: social=${m.scoreSocial}`);
        console.log(`    After:  social=${c.value}`);

        await db
          .update(events)
          .set({
            scoreSocial: c.value,
            updatedAt: new Date(),
          })
          .where(sql`${events.id} = ${m.id}`);

        updated++;
      }
    } catch (err) {
      console.error(`  [ERROR] ${c.label}:`, err);
      errors++;
    }
  }

  // -----------------------------------------------------------------------
  // Summary
  // -----------------------------------------------------------------------
  console.log('\n=== Summary ===');
  console.log(`  Updated:   ${updated} event(s)`);
  console.log(`  Not found: ${notFound} correction(s) had no matching events`);
  if (errors > 0) {
    console.log(`  Errors:    ${errors}`);
  }
  console.log('Done.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
