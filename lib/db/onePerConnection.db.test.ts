import net from 'node:net';
import postgres from 'postgres';
import { describe, expect, it } from 'vitest';
import { onePerConnection, POOL_OPTIONS } from '@/lib/db';
import { TEST_DATABASE_URL } from '@/test/database';

const QUERY = 'Q'.charCodeAt(0);
const SYNC = 'S'.charCodeAt(0);
const READY = 'Z'.charCodeAt(0);

/**
 * A pool on the test database that counts, per connection, the queries sent and not yet
 * answered. `most()` is the highest that count ever got: 1 unless a query was sent to a
 * connection still waiting for an answer.
 */
function watchedPool() {
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
          // A simple query is one Query message; any other ends with one Sync
          for (let at = 0; ready && at < chunk.length; at += chunk.readUInt32BE(at + 1) + 1) {
            if (chunk[at] === QUERY || chunk[at] === SYNC) most = Math.max(most, ++waiting);
          }
          return write(chunk, ...rest);
        }) as typeof s.write;
        resolve(s);
      });
    });

  // `socket` is a postgres.js option its types leave out
  const options = { ...POOL_OPTIONS, socket } as typeof POOL_OPTIONS;
  const client = postgres(TEST_DATABASE_URL, options);
  return { client, most: () => most };
}

const BURST = 12; // more than POOL_OPTIONS.max
const range = (n: number) => Array.from({ length: n }, (_, i) => i);

// More queries than connections, half with a parameter, on connections that are already open
async function burst(client: postgres.Sql): Promise<number[]> {
  await Promise.all(range(POOL_OPTIONS.max).map(() => client.unsafe('select 1')));
  const rows = await Promise.all(
    range(BURST).map((i) =>
      i % 2
        ? client.unsafe('select $1::int as i', [i] as never[])
        : client.unsafe(`select ${i} as i`)
    )
  );
  return rows.map(([row]) => row.i as number);
}

describe('onePerConnection', () => {
  it('is needed: postgres.js sends a query to a connection that is still waiting', async () => {
    const { client, most } = watchedPool();
    expect(await burst(client)).toEqual(range(BURST));
    expect(most()).toBeGreaterThan(1);
    await client.end();
  });

  it('gives each connection one query at a time, inside transactions too', async () => {
    const { client, most } = watchedPool();
    const pool = onePerConnection(client);
    const transactions = range(3).map((i) =>
      pool.begin('read only', async (tx) => {
        const [[a], [b]] = await Promise.all([
          tx.unsafe(`select ${i} as i`),
          tx.unsafe('select txid_current_if_assigned() is null as unassigned'),
        ]);
        return [a.i, b.unassigned] as [number, boolean];
      })
    );
    expect(await burst(pool)).toEqual(range(BURST));
    expect(await Promise.all(transactions)).toEqual(range(3).map((i) => [i, true]));
    expect(most()).toBe(1);
    await client.end();
  });

  it("keeps a caller's own query options", async () => {
    const client = postgres(TEST_DATABASE_URL, POOL_OPTIONS);
    const pool = onePerConnection(client);
    // Two statements in one query only work with the simple protocol, which is the default
    // for a query without parameters, so this fails only if `simple: false` gets through
    const twoStatements = 'select 1 as a; select 2 as b';
    const options = { simple: false } as object;
    expect(await pool.unsafe(twoStatements)).toHaveLength(2);
    await expect(pool.unsafe(twoStatements, [], options)).rejects.toThrow(/multiple commands/);
    await client.end();
  });
});
