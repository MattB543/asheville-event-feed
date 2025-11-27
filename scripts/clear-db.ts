import '../lib/config/env';

async function clearDb() {
  const { db } = await import('../lib/db');
  const { events } = await import('../lib/db/schema');

  console.log('Clearing events table...');
  try {
    await db.delete(events);
    console.log('Events table cleared.');
  } catch (error) {
    console.error('Error clearing database:', error);
  }
  process.exit(0);
}

clearDb();
