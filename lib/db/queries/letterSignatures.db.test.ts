import { beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  deleteSignature,
  getLetterPageData,
  getReviewQueue,
  setSignatureStatus,
  upsertSignature,
  type SignatureInput,
} from './letterSignatures';

const USER = '11111111-1111-4111-8111-111111111111';
const sign = (over: Partial<SignatureInput> = {}) =>
  upsertSignature(USER, {
    name: 'Sam Rivera',
    neighborhood: 'West Asheville',
    role: null,
    isPublic: true,
    wantsUpdates: false,
    ...over,
  });
const shownNames = async () => (await getLetterPageData()).shown.map((s) => s.name);
const pendingRow = async () => (await getReviewQueue()).pending[0];

describe('open letter signatures', () => {
  beforeEach(async () => {
    await db.execute(sql`TRUNCATE letter_signatures`);
  });

  it('shows a public name only once an admin approves it', async () => {
    await sign();
    expect(await shownNames()).toEqual([]);
    const row = await pendingRow();
    expect(await setSignatureStatus(row.id, 'approved', row.revision)).toBe(true);
    expect(await shownNames()).toEqual(['Sam Rivera']);
  });

  it('takes a renamed signature down for review, and refuses an Approve of the old name', async () => {
    await sign();
    const seen = await pendingRow();
    await sign({ name: 'Someone Else' });
    expect(await setSignatureStatus(seen.id, 'approved', seen.revision)).toBe(false);
    expect(await shownNames()).toEqual([]);

    const current = await pendingRow();
    await setSignatureStatus(current.id, 'approved', current.revision);
    await sign({ name: 'Third Name' });
    expect(await shownNames()).toEqual([]);
  });

  it('keeps a rejection through edits, removal and signing again', async () => {
    await sign();
    const row = await pendingRow();
    await setSignatureStatus(row.id, 'rejected', row.revision);

    expect((await sign({ name: 'New Name' })).signature.status).toBe('rejected');
    await deleteSignature(USER);
    expect((await sign()).signature.status).toBe('rejected');
    expect(await getLetterPageData()).toEqual({ total: 0, privateCount: 0, shown: [] });
  });

  it('counts a private signature at once without showing its name', async () => {
    await sign({ isPublic: false });
    expect(await getLetterPageData()).toEqual({ total: 1, privateCount: 1, shown: [] });
  });
});
