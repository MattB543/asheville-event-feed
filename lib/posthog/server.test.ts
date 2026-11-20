import { describe, expect, it } from 'vitest';
import { DrizzleQueryError } from 'drizzle-orm/errors';
import { withoutQueryValues } from './server';

/** Everything PostHog could read off an error: its message, stack and causes. */
function everythingIn(error: unknown): string {
  const parts: string[] = [];
  for (let e = error; e instanceof Error; e = e.cause) {
    parts.push(e.name, e.message, e.stack ?? '');
  }
  return parts.join('\n');
}

describe('withoutQueryValues', () => {
  const visitorId = '6f1d2c3b-aaaa-4bbb-8ccc-123456789abc';
  const typed = 'Jane Private';

  function failedQuery() {
    const database = Object.assign(
      new Error(`invalid input syntax for type uuid: "${visitorId}"`),
      { name: 'PostgresError', code: '22P02' }
    );
    return new DrizzleQueryError(
      'select "id" from "curator_profiles" where "user_id" = $1 and "name" = $2',
      [visitorId, typed],
      database
    );
  }

  it("drops a failed query's values from the message, the stack and the cause", () => {
    const original = failedQuery();
    expect(everythingIn(original)).toContain(visitorId);
    expect(everythingIn(original)).toContain(typed);

    const safe = withoutQueryValues(original);
    expect(everythingIn(safe)).not.toContain(visitorId);
    expect(everythingIn(safe)).not.toContain(typed);
  });

  it('keeps what makes the failure findable: the SQL, the database error code, the frames', () => {
    const safe = withoutQueryValues(failedQuery()) as Error;
    expect(safe.message).toBe(
      'Failed query: select "id" from "curator_profiles" where "user_id" = $1 and "name" = $2'
    );
    expect((safe.cause as Error).message).toBe('PostgresError 22P02');
    expect(safe.stack).toMatch(/\n\s+at /);
  });

  it('has no cause when the query failed without one', () => {
    const safe = withoutQueryValues(new DrizzleQueryError('select 1', [])) as Error;
    expect(safe.cause).toBeUndefined();
  });

  it('leaves every other error, and anything that is not an error, as it is', () => {
    const plain = new Error('boom');
    expect(withoutQueryValues(plain)).toBe(plain);
    expect(withoutQueryValues('a string')).toBe('a string');
    expect(withoutQueryValues(undefined)).toBeUndefined();
  });
});
