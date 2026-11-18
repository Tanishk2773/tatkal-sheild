// Choose real PostgreSQL when configured, otherwise an explicit demo emulator.
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { newDb } from 'pg-mem';

export async function createDatabase({ connectionString } = {}) {
  let pool;
  const mode = connectionString ? 'postgres' : 'demo-memory';

  if (connectionString) {
    pool = new pg.Pool({ connectionString, max: 10, connectionTimeoutMillis: 5000 });
  } else {
    const memory = newDb();
    const adapter = memory.adapters.createPg();
    pool = new adapter.Pool();
  }

  try {
    const schema = await readFile(new URL('../sql/schema.sql', import.meta.url), 'utf8');
    await pool.query(schema);

    // Seed only missing trains; restarting never resets persistent bookings.
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const date = tomorrow.toISOString().slice(0, 10);
    const trains = [
      [1, 'Deccan Dawn Express', 'Mumbai CSMT', 'Pune Junction', date + 'T06:15:00+05:30', 36],
      [2, 'Konkan Coast Express', 'Mumbai CSMT', 'Madgaon', date + 'T08:40:00+05:30', 48],
      [3, 'Capital Night Express', 'New Delhi', 'Lucknow', date + 'T22:10:00+05:30', 36]
    ];
    for (const train of trains) {
      await pool.query(
        'INSERT INTO trains (id, name, source, destination, departure, total_seats) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING',
        train
      );
    }
    return { pool, mode };
  } catch (error) {
    await pool.end();
    throw error;
  }
}
