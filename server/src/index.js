import { createApp } from './app.js';
import { createDatabase } from './db/database.js';

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '0.0.0.0';
const db = createDatabase();
const app = createApp({ db });

const server = app.listen(port, host, () => {
  console.log(`EPUB reader server listening on http://${host}:${port}`);
});

const shutdown = (signal) => {
  console.log(`${signal} received, shutting down server`);
  server.close(() => {
    db.close();
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
