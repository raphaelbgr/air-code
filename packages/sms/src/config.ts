import dotenv from 'dotenv';
import { resolve, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Walk up from this file to find the nearest .env
const __dirname = dirname(fileURLToPath(import.meta.url));
function findEnv(): string | undefined {
  let dir = __dirname;
  while (true) {
    const envPath = resolve(dir, '.env');
    if (existsSync(envPath)) return envPath;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

dotenv.config({ path: findEnv() });

export const config = {
  port: parseInt(process.env.SMS_PORT || '7331', 10),
  host: process.env.SMS_HOST || '0.0.0.0',
  dbPath: process.env.SMS_DB_PATH || './data/sessions.db',
  maxScrollback: parseInt(process.env.SMS_MAX_SCROLLBACK || '10000', 10),
  logLevel: process.env.LOG_LEVEL || 'info',
  nodeEnv: process.env.NODE_ENV || 'development',
};
