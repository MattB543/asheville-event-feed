import 'dotenv/config';
import { and, desc, eq, gt } from 'drizzle-orm';
import { db } from '../lib/db';
import { matchingProfiles } from '../lib/db/schema';
import { sendEmail } from '../lib/notifications/postmark';
import {
  buildTedxDraftInviteEmail,
  getFirstName,
} from '../lib/notifications/tedx-draft-invite-email';

// Skip anyone who existed before the accidental bulk draft-email send on March 17, 2026.
// Postmark timestamps for that batch were 2026-03-17 18:34:18-18:34:19 America/New_York
// (2026-03-17T22:34:18Z to 2026-03-17T22:34:19Z). Using the end of that window means
// future runs only target profiles created after the already-contacted cohort.
const DRAFT_REMINDER_CREATED_AFTER = new Date('2026-03-17T22:34:19.000Z');

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

  if (options.recipientName && !options.toEmail) {
    throw new Error('--recipient-name requires --to-email');
  }

  if (options.toEmail && !options.profileId && !options.recipientName) {
    throw new Error('--to-email requires --profile-id or --recipient-name');
  }

  return options;
}

async function loadTargets(options: CliOptions): Promise<TargetRow[]> {
  if (options.toEmail && options.recipientName && !options.profileId) {
    return [
      {
        profileId: 'preview',
        displayName: options.recipientName,
        email: options.toEmail,
      },
    ];
  }

  return db
    .select({
      profileId: matchingProfiles.id,
      displayName: matchingProfiles.displayName,
      email: matchingProfiles.email,
    })
    .from(matchingProfiles)
    .where(
      and(
        eq(matchingProfiles.program, options.program),
        eq(matchingProfiles.status, 'draft'),
        gt(matchingProfiles.createdAt, DRAFT_REMINDER_CREATED_AFTER),
        ...(options.profileId ? [eq(matchingProfiles.id, options.profileId)] : [])
      )
    )
    .orderBy(desc(matchingProfiles.updatedAt));
}

function getRecipientName(row: TargetRow, options: CliOptions): string {
  const value = options.recipientName || row.displayName || row.email?.split('@')[0] || 'there';
  return value.trim();
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const rows = await loadTargets(options);

  if (rows.length === 0) {
    throw new Error(`No draft profiles found for program "${options.program}"`);
  }

  let attempted = 0;
  let sent = 0;
  let skippedNoEmail = 0;

  for (const row of rows) {
    const to = options.toEmail || row.email;
    if (!to) {
      skippedNoEmail += 1;
      console.warn(`[Draft Invite] Skipping ${row.profileId}: missing recipient email`);
      continue;
    }

    const recipientName = getRecipientName(row, options);
    const firstName = getFirstName(recipientName);
    const { subject, htmlBody, textBody } = await buildTedxDraftInviteEmail({
      recipientName,
    });

    attempted += 1;

    if (options.dryRun) {
      console.log(
        `[Draft Invite] DRY RUN -> ${to} (${row.profileId}) firstName="${firstName}" name="${recipientName}"`
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
        `[Draft Invite] Sent to ${to} (${row.profileId}) firstName="${firstName}" name="${recipientName}"`
      );
    } else {
      console.error(`[Draft Invite] Failed to send to ${to} (${row.profileId})`);
    }

    if (options.toEmail) {
      break;
    }
  }

  console.log('\n[Draft Invite] Summary');
  console.log(`Mode: ${options.dryRun ? 'dry-run' : 'send'}`);
  console.log(`Program: ${options.program}`);
  console.log(`Created after: ${DRAFT_REMINDER_CREATED_AFTER.toISOString()}`);
  console.log(`Rows loaded: ${rows.length}`);
  console.log(`Attempted: ${attempted}`);
  console.log(`Sent: ${sent}`);
  console.log(`Skipped (no email): ${skippedNoEmail}`);

  process.exit(0);
}

main().catch((error) => {
  console.error('[Draft Invite] Fatal error:', error instanceof Error ? error.message : error);
  process.exit(1);
});
