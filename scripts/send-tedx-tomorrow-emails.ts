import 'dotenv/config';
import { desc, eq } from 'drizzle-orm';
import { db } from '../lib/db';
import { matchingProfiles } from '../lib/db/schema';
import { sendEmail } from '../lib/notifications/postmark';
import { buildTedxTomorrowEmail, getFirstName } from '../lib/notifications/tedx-tomorrow-email';

type CliOptions = {
  program: string;
  profileId: string | null;
  toEmail: string | null;
  recipientName: string | null;
  dryRun: boolean;
};

type TargetRow = {
  profileId: string;
  displayName: string | null;
  email: string | null;
  status: string;
};

function parseArgs(argv: string[]): CliOptions {
  const getValue = (flag: string): string | null => {
    const idx = argv.findIndex((arg) => arg === flag);
    if (idx < 0 || idx + 1 >= argv.length) return null;
    return argv[idx + 1] ?? null;
  };
  const hasFlag = (flag: string): boolean => argv.includes(flag);
  const wantsSend = hasFlag('--send');
  const wantsDryRun = hasFlag('--dry-run');

  if (wantsSend && wantsDryRun) {
    throw new Error('Use either --send or --dry-run, not both');
  }

  const options: CliOptions = {
    program: getValue('--program') ?? 'tedx',
    profileId: getValue('--profile-id'),
    toEmail: getValue('--to-email'),
    recipientName: getValue('--recipient-name'),
    dryRun: wantsDryRun || !wantsSend,
  };

  if (options.toEmail && !options.profileId) {
    throw new Error('--to-email requires --profile-id');
  }

  if (options.recipientName && !options.toEmail) {
    throw new Error('--recipient-name requires --to-email');
  }

  return options;
}

async function loadTargets(options: CliOptions): Promise<TargetRow[]> {
  const rows = await db
    .select({
      profileId: matchingProfiles.id,
      displayName: matchingProfiles.displayName,
      email: matchingProfiles.email,
      status: matchingProfiles.status,
    })
    .from(matchingProfiles)
    .where(eq(matchingProfiles.program, options.program))
    .orderBy(desc(matchingProfiles.updatedAt));

  return options.profileId ? rows.filter((row) => row.profileId === options.profileId) : rows;
}

function getRecipientName(row: TargetRow, options: CliOptions): string {
  const value = options.recipientName || row.displayName || row.email?.split('@')[0] || 'there';
  return value.trim();
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const rows = await loadTargets(options);

  if (rows.length === 0) {
    throw new Error(`No TEDx profiles found for program "${options.program}"`);
  }

  let attempted = 0;
  let sent = 0;
  let skippedNoEmail = 0;

  for (const row of rows) {
    const to = options.toEmail || row.email;
    if (!to) {
      skippedNoEmail += 1;
      console.warn(`[TEDx Tomorrow] Skipping ${row.profileId}: missing recipient email`);
      continue;
    }

    const recipientName = getRecipientName(row, options);
    const firstName = getFirstName(recipientName);
    const { subject, htmlBody, textBody } = await buildTedxTomorrowEmail({
      recipientName,
      status: row.status,
    });

    attempted += 1;

    if (options.dryRun) {
      console.log(
        `[TEDx Tomorrow] DRY RUN -> ${to} (${row.profileId}) status="${row.status}" firstName="${firstName}" name="${recipientName}"`
      );
      continue;
    }

    const ok = await sendEmail({
      to,
      subject,
      htmlBody,
      textBody,
    });

    if (ok) {
      sent += 1;
      console.log(
        `[TEDx Tomorrow] Sent to ${to} (${row.profileId}) status="${row.status}" firstName="${firstName}" name="${recipientName}"`
      );
    } else {
      console.error(`[TEDx Tomorrow] Failed to send to ${to} (${row.profileId})`);
    }

    if (options.toEmail) {
      break;
    }
  }

  console.log('\n[TEDx Tomorrow] Summary');
  console.log(`Mode: ${options.dryRun ? 'dry-run' : 'send'}`);
  console.log(`Program: ${options.program}`);
  console.log(`Rows loaded: ${rows.length}`);
  console.log(`Attempted: ${attempted}`);
  console.log(`Sent: ${sent}`);
  console.log(`Skipped (no email): ${skippedNoEmail}`);

  process.exit(0);
}

main().catch((error) => {
  console.error('[TEDx Tomorrow] Fatal error:', error instanceof Error ? error.message : error);
  process.exit(1);
});
