/**
 * Add last_verified_at column to events table.
 */

import postgres from "postgres";
import { env } from "../lib/config/env";

async function main() {
  const sql = postgres(env.DATABASE_URL, { prepare: false });

  console.log("Adding last_verified_at column to events table...");

  try {
    await sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMP WITH TIME ZONE`;
    console.log("Column added successfully!");
  } catch (error) {
    console.error("Error adding column:", error);
  }

  await sql.end();
  process.exit(0);
}

main();
