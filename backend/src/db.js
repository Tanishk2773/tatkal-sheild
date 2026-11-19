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
    const tomorrow = new Date(Date.now() + 86_400_000);
    const date = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(tomorrow);
    const trains = [
      [1, 'Deccan Dawn Express', 'Mumbai CSMT', 'Pune Junction', '06:15', 36],
      [2, 'Konkan Coast Express', 'Mumbai CSMT', 'Madgaon', '08:40', 48],
      [3, 'Capital Night Express', 'New Delhi', 'Lucknow', '22:10', 36],
      [4, 'Sahyadri Intercity', 'Mumbai CSMT', 'Pune Junction', '11:30', 36],
      [5, 'Deccan Evening Express', 'Mumbai CSMT', 'Pune Junction', '18:15', 42],
      [6, 'Mandovi Coastliner', 'Mumbai CSMT', 'Madgaon', '14:05', 42],
      [7, 'Awadh Day Express', 'New Delhi', 'Lucknow', '07:45', 36],
      [8, 'Kaveri Intercity', 'KSR Bengaluru', 'Mysuru Junction', '09:20', 36],
      [9, 'Mysuru Evening Express', 'KSR Bengaluru', 'Mysuru Junction', '17:40', 36]
    ];
    for (const [id, name, source, destination, time, seats] of trains) {
      await pool.query(
        'INSERT INTO trains (id, name, source, destination, departure, total_seats) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING',
        [id, name, source, destination, date + 'T' + time + ':00+05:30', seats]
      );
    }
    return { pool, mode };
  } catch (error) {
    await pool.end();
    throw error;
  }
}
