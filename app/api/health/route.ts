import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { events } from '@/lib/db/schema';
import { sql } from 'drizzle-orm';

export async function GET() {
  const startTime = Date.now();

  try {
    // Test database connection with a simple count query
    const result = await db.select({ count: sql`count(*)` }).from(events);
    const eventCount = Number(result[0]?.count) || 0;

    return NextResponse.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: 'connected',
      eventCount,
      responseTime: `${Date.now() - startTime}ms`,
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        database: 'disconnected',
        error: String(error),
        responseTime: `${Date.now() - startTime}ms`,
      },
      { status: 503 }
    );
  }
}
