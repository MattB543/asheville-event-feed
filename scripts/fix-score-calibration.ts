import 'dotenv/config';
import { db } from '../lib/db';
import { events } from '../lib/db/schema';
import { ilike } from 'drizzle-orm';

interface ScoreCorrection {
  titlePattern: string;
  scores: {
    score: number;
    scoreRarity: number;
    scoreUnique: number;
    scoreMagnitude: number;
    scoreReason: string;
  };
}

const corrections: ScoreCorrection[] = [
  // 1. Art Museum Exhibits - drastically underscored
  {
    titlePattern: '%Look Homeward, Angel%',
    scores: {
      score: 16,
      scoreRarity: 3,
      scoreUnique: 8,
      scoreMagnitude: 5,
      scoreReason:
        "Major museum exhibit at Asheville Art Museum celebrating Thomas Wolfe - deeply tied to Asheville's literary identity.",
    },
  },
  {
    titlePattern: '%Lasting Legacies%',
    scores: {
      score: 15,
      scoreRarity: 3,
      scoreUnique: 8,
      scoreMagnitude: 4,
      scoreReason:
        'Museum exhibit on Asheville architecture history - uniquely local subject matter at a major cultural institution.',
    },
  },
  {
    titlePattern: '%Women of the Pacific Northwest%',
    scores: {
      score: 14,
      scoreRarity: 3,
      scoreUnique: 5,
      scoreMagnitude: 6,
      scoreReason:
        'Professional museum exhibit at Asheville Art Museum - significant cultural institution, though not Asheville-specific subject.',
    },
  },
  {
    titlePattern: '%Highwater%',
    scores: {
      score: 14,
      scoreRarity: 3,
      scoreUnique: 5,
      scoreMagnitude: 6,
      scoreReason:
        'Professional museum exhibit at Asheville Art Museum - major downtown cultural institution.',
    },
  },

  // 2. Small workshops with inflated magnitude
  {
    titlePattern: '%Body Worship%',
    scores: {
      score: 15,
      scoreRarity: 7,
      scoreUnique: 6,
      scoreMagnitude: 2,
      scoreReason:
        'Intimate trauma-informed workshop - unique concept but small-scale private class, not a public draw.',
    },
  },
  {
    titlePattern: '%The Compass Within%',
    scores: {
      score: 17,
      scoreRarity: 8,
      scoreUnique: 7,
      scoreMagnitude: 2,
      scoreReason:
        'Specialized personal development workshop - niche and rare but small private gathering.',
    },
  },

  // 3. Killers of Kill Tony - touring show, not Asheville-unique
  {
    titlePattern: '%Killers of Kill Tony%',
    scores: {
      score: 21,
      scoreRarity: 8,
      scoreUnique: 4,
      scoreMagnitude: 9,
      scoreReason:
        'Major touring comedy show at Thomas Wolfe Auditorium - high-draw national act, but cookie-cutter roadshow format.',
    },
  },

  // 4. Thomas Dambo Trolls - underscored rarity
  {
    titlePattern: '%Thomas Dambo%',
    scores: {
      score: 22,
      scoreRarity: 8,
      scoreUnique: 7,
      scoreMagnitude: 7,
      scoreReason:
        "World-famous artist's troll sculptures - rare destination attraction that draws visitors specifically to the region.",
    },
  },

  // 5. Lexington Glassworks Seconds Sale - cult Asheville event
  {
    titlePattern: '%Seconds Sale%Lexington%',
    scores: {
      score: 24,
      scoreRarity: 9,
      scoreUnique: 9,
      scoreMagnitude: 6,
      scoreReason:
        'Once-a-year cult event - people camp out overnight. Quintessential Asheville maker culture moment.',
    },
  },
  {
    titlePattern: '%Lexington%Seconds Sale%',
    scores: {
      score: 24,
      scoreRarity: 9,
      scoreUnique: 9,
      scoreMagnitude: 6,
      scoreReason:
        'Once-a-year cult event - people camp out overnight. Quintessential Asheville maker culture moment.',
    },
  },

  // 6. Scrappin' With The Girls - closed retreat, lower magnitude
  {
    titlePattern: '%Scrappin%With%Girls%',
    scores: {
      score: 14,
      scoreRarity: 6,
      scoreUnique: 5,
      scoreMagnitude: 3,
      scoreReason:
        'Sold-out private scrapbooking retreat - not accessible to general public despite 200 participants.',
    },
  },
];

async function fixScoreCalibration() {
  console.log('Starting score calibration fixes...\n');

  let totalUpdated = 0;

  for (const correction of corrections) {
    const result = await db
      .update(events)
      .set({
        score: correction.scores.score,
        scoreRarity: correction.scores.scoreRarity,
        scoreUnique: correction.scores.scoreUnique,
        scoreMagnitude: correction.scores.scoreMagnitude,
        scoreReason: correction.scores.scoreReason,
      })
      .where(ilike(events.title, correction.titlePattern))
      .returning({ id: events.id, title: events.title });

    if (result.length > 0) {
      console.log(`✓ Updated ${result.length} event(s) matching "${correction.titlePattern}":`);
      for (const event of result) {
        console.log(`  - ${event.title}`);
        console.log(
          `    New score: ${correction.scores.score}/30 (R:${correction.scores.scoreRarity}, U:${correction.scores.scoreUnique}, M:${correction.scores.scoreMagnitude})`
        );
      }
      totalUpdated += result.length;
    } else {
      console.log(`⚠ No events found matching "${correction.titlePattern}"`);
    }
    console.log('');
  }

  console.log('---');
  console.log(`Total events updated: ${totalUpdated}`);
}

fixScoreCalibration()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
