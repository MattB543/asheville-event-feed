import net from 'node:net';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { describe, expect, it, vi } from 'vitest';
import { onePerConnection, POOL_OPTIONS } from '@/lib/db';
import { TEST_DATABASE_URL } from '@/test/database';

const QUERY = 'Q'.charCodeAt(0);
const PARSE = 'P'.charCodeAt(0);
const READY = 'Z'.charCodeAt(0);

/**
 * What a watched pool saw on the wire. `most()` is the most queries any connection had begun
 * and not yet answered: 1 unless a query was sent to a connection still waiting for an answer.
 * `log` has a line per query sent ("2 begin": connection 2, the query's first word) and per
 * answer finished ("2 ready I": I for idle, T for inside a transaction).
 */
type Watch = { most: () => number; log: string[] };

/**
 * Runs `run` with a pool on the test database and what it saw on the wire. The watching reads
 * plain TCP, which is what the test database speaks.
 */
async function withWatchedPool<T>(
  run: (client: postgres.Sql, watch: Watch) => Promise<T>
): Promise<T> {
  const url = new URL(TEST_DATABASE_URL);
  const log: string[] = [];
  let most = 0;
  let connections = 0;

  const socket = () =>
    new Promise<net.Socket>((resolve, reject) => {
      const s = new net.Socket();
      const id = ++connections;
      let ready = false; // the handshake's messages aren't queries
      let waiting = 0;
      let unread = Buffer.alloc(0);

      s.on('data', (chunk: Buffer) => {
        unread = Buffer.concat([unread, chunk]);
        // Each message is a type byte, then a length that counts itself but not the type
        while (unread.length >= 5 && unread.length > unread.readUInt32BE(1)) {
          if (unread[0] === READY) {
            if (ready) {
              waiting--;
              log.push(`${id} ready ${String.fromCharCode(unread[5])}`);
            }
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
            if (chunk[at] !== QUERY && chunk[at] !== PARSE) continue;
            most = Math.max(most, ++waiting);
            const text = chunk.toString('utf8', at + 5, at + 1 + chunk.readUInt32BE(at + 1));
            log.push(`${id} ${/[a-z]+/i.exec(text)?.[0].toLowerCase()}`);
          }
          return write(chunk, ...rest);
        }) as typeof s.write;
        resolve(s);
      });
    });

  // `socket` is a postgres.js option its types leave out
  const client = postgres(TEST_DATABASE_URL, { ...POOL_OPTIONS, socket } as typeof POOL_OPTIONS);
  try {
    return await run(client, { most: () => most, log });
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
    await withWatchedPool(async (client, { most }) => {
      expect(await burst(client)).toEqual(range(BURST));
      expect(most()).toBeGreaterThan(1);
    });
  });

  it('gives each connection one query at a time, inside transactions too', async () => {
    await withWatchedPool(async (client, { most }) => {
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
      const [answers, inTransactions] = await Promise.all([burst(pool), Promise.all(transactions)]);
      expect(answers).toEqual(range(BURST));
      expect(inTransactions).toEqual(range(3).map((i) => [i, i, 'on']));
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
    await withWatchedPool(async (client, { log }) => {
      const db = drizzle(onePerConnection(client));
      const nothing = () => Promise.resolve();

      const nested = db.transaction(async (tx) => {
        await tx.execute(sql`select 1`);
        await tx.transaction(nothing);
      });
      await expect(nested).rejects.toThrow(/Nested transactions are not supported/);
      // The connection that ran BEGIN ended on ROLLBACK and then idle, so it is free again
      await vi.waitFor(() => {
        const connection = log.find((line) => line.endsWith(' begin'))?.split(' ')[0];
        const onIt = log.filter((line) => line.startsWith(`${connection} `));
        expect(onIt.slice(-2)).toEqual([`${connection} rollback`, `${connection} ready I`]);
      });

      // A caller may catch the refusal and carry on with the outer transaction
      const caught = db.transaction((tx) => tx.transaction(nothing).catch(() => 'refused'));
      expect(await caught).toBe('refused');
      expect(log.filter((line) => line.endsWith(' savepoint'))).toEqual([]);
    });
  });
});
