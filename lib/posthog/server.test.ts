import { describe, expect, it } from 'vitest';
import { DrizzleQueryError } from 'drizzle-orm/errors';
import { PostHog } from 'posthog-node';
import { withoutQueryValues } from './server';

const visitorId = '6f1d2c3b-aaaa-4bbb-8ccc-123456789abc';
// What someone typed, over several lines, one of which reads like a stack frame
const typed = 'Jane Private\n    at secretFunction (/private/typed-path.js:1:1)\nlast line';
const SQL = 'select "id" from "curator_profiles" where "user_id" = $1 and "name" = $2';

function failedQuery(): DrizzleQueryError {
  const database = Object.assign(new Error(`invalid input syntax for type uuid: "${visitorId}"`), {
    name: 'PostgresError',
    code: '22P02',
    detail: `Key (name)=(${typed})`,
  });
  return new DrizzleQueryError(SQL, [visitorId, typed], database);
}

// The SDK attaches the source lines around each frame. Here those are this
// file's own lines, which spell out the private values above.
const SOURCE_LINES = ['pre_context', 'context_line', 'post_context'];

/**
 * The event the installed PostHog SDK would send for this error, as text: it is
 * handed to beforeSend, which keeps it and stops it going anywhere.
 */
async function asSentToPostHog(error: unknown): Promise<string> {
  let sent = '';
  const posthog = new PostHog('phc_test', {
    flushAt: 1,
    flushInterval: 0,
    beforeSend: (event) => {
      sent += JSON.stringify(event, (key, value: unknown) =>
        SOURCE_LINES.includes(key) ? undefined : value
      );
      return null;
    },
  });
  posthog.captureException(error);
  await posthog.shutdown();
  return sent;
}

const PRIVATE = [visitorId, 'Jane Private', 'secretFunction', 'typed-path', 'last line'];

async function expectNothingPrivate(error: unknown) {
  const sent = await asSentToPostHog(withoutQueryValues(error));
  expect(sent).toContain('$exception_list');
  for (const marker of PRIVATE) expect(sent).not.toContain(marker);
  return sent;
}

describe('withoutQueryValues', () => {
  it('is needed: the SDK would send the values of an untouched failed query', async () => {
    const sent = await asSentToPostHog(failedQuery());
    expect(sent).toContain(visitorId);
    expect(sent).toContain('Jane Private');
  });

  it("sends none of a failed query's values, even one that looks like a stack frame", async () => {
    const sent = await expectNothingPrivate(failedQuery());
    expect(sent).toContain(`Failed query: ${SQL.replaceAll('"', '\\"')}`);
    expect(sent).toContain('PostgresError 22P02');
  });

  it('keeps the frames of where the query was run', () => {
    const safe = withoutQueryValues(failedQuery()) as Error;
    // This file is in the original stack: failedQuery() above made the error
    expect(safe.stack).toMatch(/\n\s+at .*server\.test\.ts/);
    expect((safe.cause as Error).stack).toBe('Error: PostgresError 22P02');
  });

  it('drops the frames when the stack does not open with the message', () => {
    const error = failedQuery();
    error.stack = `Something else\n${typed}\n    at real (file.js:1:1)`;
    const safe = withoutQueryValues(error) as Error;
    expect(safe.stack).toBe(`Error: Failed query: ${SQL}`);
  });

  it('finds a failed query under another error', async () => {
    const wrapped = new Error('Could not load the camps', { cause: failedQuery() });
    const sent = await expectNothingPrivate(wrapped);
    expect(sent).toContain('Could not load the camps');
    expect(sent).toContain('PostgresError 22P02');
  });

  it('finds failed queries inside an AggregateError', async () => {
    const both = new AggregateError([failedQuery(), new Error('plain')], 'Two things failed');
    const safe = withoutQueryValues(both) as AggregateError;
    expect(safe).toBeInstanceOf(AggregateError);
    expect(safe.errors).toHaveLength(2);
    expect((safe.errors[0] as Error).message).toBe(`Failed query: ${SQL}`);
    expect((safe.errors[1] as Error).message).toBe('plain');
    await expectNothingPrivate(both);
  });

  it('has no cause when the query failed without one', () => {
    const safe = withoutQueryValues(new DrizzleQueryError('select 1', [])) as Error;
    expect(safe.cause).toBeUndefined();
  });

  it('survives an error that is its own cause', () => {
    const loop = new Error('loop');
    loop.cause = new Error('inner', { cause: loop });
    expect(withoutQueryValues(loop)).toBeInstanceOf(Error);
  });

  it('gives back the same object when there is no failed query in it', () => {
    const plain = new Error('boom', { cause: new Error('why') });
    expect(withoutQueryValues(plain)).toBe(plain);
    const group = new AggregateError([new Error('a')], 'group');
    expect(withoutQueryValues(group)).toBe(group);
    expect(withoutQueryValues('a string')).toBe('a string');
    expect(withoutQueryValues(undefined)).toBeUndefined();
  });
});
