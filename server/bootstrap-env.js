/**
 * Boot-time env loader.
 *
 * F-018: server/.env was historically loaded as a side effect of
 * middleware/auth.js importing dotenv at module-load. That only worked
 * because routes.js (which transitively imports auth) happened to be
 * imported before db.js in server.js — db.js reads `process.env.ROHY_DB`
 * at module-load time. Reorder those imports and the wrong database
 * opens.
 *
 * This module is a side-effect import. Putting it as the FIRST import
 * in server/server.js guarantees `.env` is materialized before any other
 * server module reads `process.env`. The duplicate `dotenv.config` in
 * middleware/auth.js is left in place so unit tests that import auth.js
 * directly (without going through server.js) keep working — dotenv is
 * idempotent, the second call is a no-op.
 */

import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });
