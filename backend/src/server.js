// Start locally; a configured PostgreSQL connection never silently falls back.
import { createDatabase } from './db.js';
import { createApp } from './app.js';

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';
let database;
let server;

try {
  database = await createDatabase({ connectionString: process.env.DATABASE_URL });
  const app = createApp(database, { secureCookies: process.env.SECURE_COOKIES === 'true' });
  server = app.listen(port, host, () => {
    console.log('Tatkal Shield — Phase 1');
    console.log('Local: http://' + host + ':' + port);
    console.log('Storage: ' + database.mode);
    if (database.mode === 'demo-memory') {
      console.log('Demo data resets on restart. Set DATABASE_URL for persistent PostgreSQL.');
    }
  });
  server.on('error', async error => {
    console.error('Could not start the server:', error.message);
    await database.pool.end();
    process.exitCode = 1;
  });
} catch (error) {
  console.error('Startup failed:', error.message);
  process.exitCode = 1;
}

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  if (server?.listening) {
    server.close(async () => {
      await database.pool.end();
      process.exit(0);
    });
    server.closeIdleConnections();
  } else {
    await database?.pool.end();
    process.exit(0);
  }
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
