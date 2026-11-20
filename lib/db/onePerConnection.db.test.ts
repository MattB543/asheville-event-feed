import net from 'node:net';
import postgres from 'postgres';
import { describe, expect, it } from 'vitest';
import { onePerConnection, POOL_OPTIONS } from '@/lib/db';
import { TEST_DATABASE_URL } from '@/test/database';

const QUERY = 'Q'.charCodeAt(0);
const PARSE = 'P'.charCodeAt(0);
const READY = 'Z'.charCodeAt(0);

/**
 * Runs `run` with a pool on the test database that counts, per connection, the queries begun
 * and not yet answered. `most()` is the highest that count ever got: 1 unless a query was sent
 * to a connection still waiting for an answer. The counting reads plain TCP, which is what the
 * test database speaks.
 */
async function withWatchedPool<T>(
  run: (client: postgres.Sql, most: () => number) => Promise<T>
): Promise<T> {
  const url = new URL(TEST_DATABASE_URL);
  let most = 0;

  const socket = () =>
    new Promise<net.Socket>((resolve, reject) => {
      const s = new net.Socket();
      let ready = false; // the handshake's messages aren't queries
      let waiting = 0;
      let unread = Buffer.alloc(0);

      s.on('data', (chunk: Buffer) => {
        unread = Buffer.concat([unread, chunk]);
        // Each message is a type byte, then a length that counts itself but not the type
        while (unread.length >= 5 && unread.length > unread.readUInt32BE(1)) {
          if (unread[0] === READY) {
            if (ready) waiting--;
            ready = true;
          }
          unread = unread.subarray(unread.readUInt32BE(1) + 1);
        }
      });
      s.once('error', reject);
      s.connect(Number(url.port || 5432), url.hostname, () => {
        // Only now: connect() puts the socket's own write back
        const write = s.write.bind(s) as (...args: unknown[]) => boolean;
        s.write = ((chunk: Buffer, ...rest: unknown[]) => {
          // A query begins with a Query message, or with a Parse when it has parameters
          // (its Bind and Sync may follow in a later write)
          for (let at = 0; ready && at < chunk.length; at += chunk.readUInt32BE(at + 1) + 1) {
            if (chunk[at] === QUERY || chunk[at] === PARSE) most = Math.max(most, ++waiting);
          }
          return write(chunk, ...rest);
        }) as typeof s.write;
        resolve(s);
      });
    });

  // `socket` is a postgres.js option its types leave out
  const client = postgres(TEST_DATABASE_URL, { ...POOL_OPTIONS, socket } as typeof POOL_OPTIONS);
  try {
    return await run(client, () => most);
  } finally {
    await client.end({ timeout: 2 });
  }
}

const BURST = 12; // more than POOL_OPTIONS.max
const range = (n: number) => Array.from({ length: n }, (_, i) => i);

// More queries than connections, half with a parameter, on connections that are already open
async function burst(client: postgres.Sql): Promise<number[]> {
  await Promise.all(range(POOL_OPTIONS.max).map(() => client.unsafe('select 1')));
  const rows = await Promise.all(
    range(BURST).map((i) =>
      i % 2 ? client.unsafe('select $1::int as i', [i]) : client.unsafe(`select ${i} as i`)
    )
  );
  return rows.map(([row]) => row.i as number);
}

describe('onePerConnection', () => {
  it('is needed: postgres.js sends a query to a connection that is still waiting', async () => {
    await withWatchedPool(async (client, most) => {
      expect(await burst(client)).toEqual(range(BURST));
      expect(most()).toBeGreaterThan(1);
    });
  });

  it('gives each connection one query at a time, inside transactions too', async () => {
    await withWatchedPool(async (client, most) => {
      const pool = onePerConnection(client);
      const transactions = range(3).map((i) =>
        pool.begin('read only', async (tx) => {
          // Two at once, one of each kind; `ro` is 'on' only inside this transaction
          const [[a], [b]] = await Promise.all([
            tx.unsafe(`select ${i} as i`),
            tx.unsafe("select current_setting('transaction_read_only') as ro, $1::int as i", [i]),
          ]);
          return [a.i, b.i, b.ro] as [number, number, string];
        })
      );
      expect(await burst(pool)).toEqual(range(BURST));
      expect(await Promise.all(transactions)).toEqual(range(3).map((i) => [i, i, 'on']));
      expect(most()).toBe(1);
    });
  });

  it("keeps a caller's own query options", async () => {
    await withWatchedPool(async (client) => {
      const pool = onePerConnection(client);
      // Two statements in one query only work with the simple protocol, which is the default
      // for a query without parameters, so these fail only if `simple: false` gets through
      const twoStatements = 'select 1 as a; select 2 as b';
      const options = { simple: false } as object;
      // postgres.js also takes the options second; its types don't say so
      const twoArguments = (query: string, second: object) =>
        (pool.unsafe as (query: string, second: object) => Promise<unknown>)(query, second);
      expect(await pool.unsafe(twoStatements)).toHaveLength(2);
      await expect(pool.unsafe(twoStatements, [], options)).rejects.toThrow(/multiple commands/);
      await expect(twoArguments(twoStatements, options)).rejects.toThrow(/multiple commands/);
    });
  });

  it('refuses a nested transaction, whose SAVEPOINT it could not hold back', async () => {
    await withWatchedPool(async (client) => {
      const pool = onePerConnection(client);
      const nested = pool.begin((tx) => tx.savepoint((inner) => inner.unsafe('select 1')));
      await expect(nested).rejects.toThrow(/Nested transactions are not supported/);
      // The outer transaction was rolled back and its connection given back
      expect(await pool.unsafe('select 1 as one')).toEqual([{ one: 1 }]);
    });
  });
});
