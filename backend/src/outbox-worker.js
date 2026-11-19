import pg from 'pg';
import { setTimeout as delay } from 'node:timers/promises';

if (!process.env.DATABASE_URL) throw Error('The outbox worker requires PostgreSQL.');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 5000 });
const shutdown = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => shutdown.abort());

try {
  while (!shutdown.signal.aborted) {
    try {
      await pool.query(`
        INSERT INTO booking_event_projection (event_id, payload)
        SELECT event_id, payload FROM booking_outbox
        WHERE NOT EXISTS (
          SELECT 1 FROM booking_event_projection WHERE event_id = booking_outbox.event_id
        )
        ORDER BY created_at, event_id
        LIMIT 100
        ON CONFLICT (event_id) DO NOTHING
      `);
    } catch (error) {
      console.error('Booking projection unavailable. Retrying.', error.code || error.name);
    }
    await delay(1000, undefined, { signal: shutdown.signal }).catch(error => {
      if (error.name !== 'AbortError') throw error;
    });
  }
} finally {
  await pool.end();
}
