import { env } from '../lib/config/env';
import { GET as scrapeCron } from '../app/api/cron/scrape/route';
import { GET as cleanupCron } from '../app/api/cron/cleanup/route';
import { GET as dedupCron } from '../app/api/cron/dedup/route';
import { GET as aiCron } from '../app/api/cron/ai/route';
import { scrapeLittleAnimals } from '../lib/scrapers/littleanimals';
import { db } from '../lib/db';
import { events } from '../lib/db/schema';
import type { ScrapedEvent } from '../lib/scrapers/types';

type StepResult = {
  name: string;
  ok: boolean;
  status: number;
  durationMs: number;
  body: unknown;
};

const chunk = <T>(arr: T[], size: number) =>
  Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
    arr.slice(i * size, i * size + size)
  );

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

function buildRequest(path: string): Request {
  return new Request(`http://localhost${path}`, {
    headers: {
      authorization: `Bearer ${env.CRON_SECRET}`,
    },
  });
}

async function parseResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw: text };
  }
}

async function runRouteStep(
  name: string,
  path: string,
  handler: (request: Request) => Promise<Response>
): Promise<StepResult> {
  const start = Date.now();
  const response = await handler(buildRequest(path));
  const durationMs = Date.now() - start;
  const body = await parseResponse(response);
  const successFlag = isRecord(body) && 'success' in body ? body.success : undefined;
  const ok = response.ok && successFlag !== false;

  console.log(`[Runner] ${name} status=${response.status} ok=${ok} duration=${durationMs}ms`);
  return { name, ok, status: response.status, durationMs, body };
}

async function upsertScrapedEvents(scrapedEvents: ScrapedEvent[], sourceName: string) {
  let success = 0;
  let failed = 0;

  for (const batch of chunk(scrapedEvents, 10)) {
    await Promise.all(
      batch.map(async (event) => {
        try {
          await db
            .insert(events)
            .values({
              sourceId: event.sourceId,
              source: event.source,
              title: event.title,
              description: event.description,
              startDate: event.startDate,
              location: event.location,
              zip: event.zip,
              organizer: event.organizer,
              price: event.price,
              url: event.url,
              imageUrl: event.imageUrl,
              tags: [],
              interestedCount: event.interestedCount,
              goingCount: event.goingCount,
              timeUnknown: event.timeUnknown || false,
              lastSeenAt: new Date(),
            })
            .onConflictDoUpdate({
              target: events.url,
              set: {
                title: event.title,
                description: event.description,
                startDate: event.startDate,
                location: event.location,
                zip: event.zip,
                organizer: event.organizer,
                price: event.price,
                imageUrl: event.imageUrl,
                interestedCount: event.interestedCount,
                goingCount: event.goingCount,
                lastSeenAt: new Date(),
              },
            });
          success++;
        } catch (err) {
          failed++;
          console.error(
            `[Runner] Failed to upsert "${event.title}" (${event.source}):`,
            err instanceof Error ? err.message : err
          );
        }
      })
    );
  }

  console.log(`[Runner] ${sourceName}: ${success} upserted, ${failed} failed`);
  return { success, failed };
}

async function runLittleAnimalsStep(): Promise<StepResult> {
  const start = Date.now();
  console.log('[Runner] Running Little Animals scraper...');

  const events = await scrapeLittleAnimals(false);
  console.log(`[Runner] Little Animals scraped: ${events.length}`);

  const { success, failed } = await upsertScrapedEvents(events, 'Little Animals');

  const durationMs = Date.now() - start;
  const ok = failed === 0;
  return {
    name: 'littleanimals',
    ok,
    status: ok ? 200 : 500,
    durationMs,
    body: { scraped: events.length, upserted: success, failed },
  };
}

async function main() {
  if (!env.CRON_SECRET) {
    console.error('CRON_SECRET not set in .env');
    process.exit(1);
  }

  const results: StepResult[] = [];

  console.log('[Runner] Starting full pipeline...');

  const scrapeResult = await runRouteStep('scrape', '/api/cron/scrape', scrapeCron);
  results.push(scrapeResult);
  if (!scrapeResult.ok) {
    throw new Error('Scrape step failed. Aborting.');
  }

  const littleAnimalsResult = await runLittleAnimalsStep();
  results.push(littleAnimalsResult);
  if (!littleAnimalsResult.ok) {
    throw new Error('Little Animals step failed. Aborting.');
  }

  const cleanupResult = await runRouteStep('cleanup', '/api/cron/cleanup', cleanupCron);
  results.push(cleanupResult);
  if (!cleanupResult.ok) {
    throw new Error('Cleanup step failed. Aborting.');
  }

  const dedupResult = await runRouteStep('dedup', '/api/cron/dedup', dedupCron);
  results.push(dedupResult);
  if (!dedupResult.ok) {
    throw new Error('Dedup step failed. Aborting.');
  }

  const aiResult = await runRouteStep('ai', '/api/cron/ai', aiCron);
  results.push(aiResult);
  if (!aiResult.ok) {
    throw new Error('AI step failed. Aborting.');
  }

  console.log('[Runner] Pipeline complete.');
  console.log(JSON.stringify({ results }, null, 2));
}

main().catch((error) => {
  console.error('[Runner] Fatal error:', error instanceof Error ? error.message : error);
  process.exit(1);
});
