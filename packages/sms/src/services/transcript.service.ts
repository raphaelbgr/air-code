import pino from 'pino';
import { getDb } from '../db/index.js';

const log = pino({ name: 'transcript' });

export class TranscriptService {
  /**
   * Append transcript content for a session.
   */
  append(sessionId: string, content: string): void {
    const db = getDb();
    db.prepare('INSERT INTO transcripts (session_id, content) VALUES (?, ?)').run(sessionId, content);
  }

  /**
   * Get transcript entries for a session.
   */
  get(sessionId: string, limit = 100): { content: string; timestamp: string }[] {
    const db = getDb();
    return db
      .prepare('SELECT content, timestamp FROM transcripts WHERE session_id = ? ORDER BY timestamp DESC LIMIT ?')
      .all(sessionId, limit) as { content: string; timestamp: string }[];
  }

  /**
   * Delete all transcripts for a session.
   */
  clear(sessionId: string): void {
    const db = getDb();
    db.prepare('DELETE FROM transcripts WHERE session_id = ?').run(sessionId);
    log.info({ sessionId }, 'transcripts cleared');
  }
}
