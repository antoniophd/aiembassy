// Starts the site on HOST:PORT (default 127.0.0.1:3910), database read-only.
//   node cli/web.ts
import { databasePath, openReadOnly } from '../engine/db/index.ts';
import { startServer } from '../web/server.ts';

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT) || 3910;
const db = openReadOnly(databasePath());
startServer(db, host, port).on('listening', () => console.log(`Embassy site on http://${host}:${port}`));
const stop = () => process.exit(0);
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
