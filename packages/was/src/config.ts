import dotenv from 'dotenv';
import { resolve, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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
  port: parseInt(process.env.WAS_PORT || '7333', 10),
  host: process.env.WAS_HOST || '0.0.0.0',
  smsUrl: process.env.WAS_SMS_URL || 'http://localhost:7331',
  jwtSecret: process.env.WAS_JWT_SECRET || 'dev-secret-change-me',
  jwtExpiry: process.env.WAS_JWT_EXPIRY || '7d',
  dbPath: process.env.WAS_DB_PATH || './data/was.db',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  aiModel: process.env.AI_AGENT_MODEL || 'claude-sonnet-4-20250514',
  aiMaxTokens: parseInt(process.env.AI_AGENT_MAX_TOKENS || '4096', 10),
  logLevel: process.env.LOG_LEVEL || 'info',
  nodeEnv: process.env.NODE_ENV || 'development',
};
