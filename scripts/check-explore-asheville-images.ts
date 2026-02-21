import { db } from '../lib/db';
import { events } from '../lib/db/schema';
import { eq, gte, desc, and, isNotNull } from 'drizzle-orm';

interface ImageCheckResult {
  status: number | string;
  contentType: string | null;
  redirected: boolean;
  finalUrl: string | null;
  error: string | null;
}

async function checkImageUrl(url: string): Promise<ImageCheckResult> {
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    return {
      status: response.status,
      contentType: response.headers.get('content-type'),
      redirected: response.redirected,
      finalUrl: response.redirected ? response.url : null,
      error: null,
    };
  } catch {
    // Some servers block HEAD requests -- fall back to GET with Range header
    try {
      const response = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(10000),
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Range: 'bytes=0-0',
        },
      });

      return {
        status: response.status,
        contentType: response.headers.get('content-type'),
        redirected: response.redirected,
        finalUrl: response.redirected ? response.url : null,
        error: '(HEAD blocked, used GET fallback)',
      };
    } catch (getErr: unknown) {
      const message = getErr instanceof Error ? getErr.message : String(getErr);
      return {
        status: 'FAILED',
        contentType: null,
        redirected: false,
        finalUrl: null,
        error: message,
      };
    }
  }
}

function isImageOk(result: ImageCheckResult): boolean {
  return (
    (result.status === 200 || result.status === 206) &&
    (result.contentType?.startsWith('image/') ?? false)
  );
}

async function main() {
  console.log('Fetching top 10 upcoming EXPLORE_ASHEVILLE events by score...\n');

  const now = new Date();

  const rows = await db
    .select({
      title: events.title,
      imageUrl: events.imageUrl,
      score: events.score,
      startDate: events.startDate,
      url: events.url,
    })
    .from(events)
    .where(
      and(
        eq(events.source, 'EXPLORE_ASHEVILLE'),
        gte(events.startDate, now),
        eq(events.hidden, false),
        isNotNull(events.imageUrl)
      )
    )
    .orderBy(desc(events.score))
    .limit(10);

  if (rows.length === 0) {
    console.log('No upcoming EXPLORE_ASHEVILLE events with images found.');
    process.exit(0);
  }

  console.log(`Found ${rows.length} events. Checking image URLs...\n`);
  console.log('='.repeat(100));

  let okCount = 0;
  let brokenCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const event = rows[i];
    console.log(`\n[${i + 1}/${rows.length}] ${event.title}`);
    console.log(`  Score: ${event.score ?? 'N/A'}`);
    console.log(`  Date:  ${event.startDate.toISOString()}`);
    console.log(`  Event URL: ${event.url}`);
    console.log(`  Image URL: ${event.imageUrl}`);

    const result = await checkImageUrl(event.imageUrl!);

    console.log(`  --- Image Check ---`);
    console.log(`  HTTP Status:  ${result.status}`);
    console.log(`  Content-Type: ${result.contentType ?? 'N/A'}`);
    if (result.redirected) {
      console.log(`  Redirected:   YES -> ${result.finalUrl}`);
    }
    if (result.error) {
      console.log(`  Note: ${result.error}`);
    }

    const ok = isImageOk(result);
    console.log(`  Verdict: ${ok ? 'OK' : 'BROKEN'}`);
    console.log('-'.repeat(100));

    if (ok) okCount++;
    else brokenCount++;
  }

  // Summary
  console.log('\n' + '='.repeat(100));
  console.log('SUMMARY');
  console.log('='.repeat(100));
  console.log(`  OK:     ${okCount}/${rows.length}`);
  console.log(`  Broken: ${brokenCount}/${rows.length}`);
  console.log('');

  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
