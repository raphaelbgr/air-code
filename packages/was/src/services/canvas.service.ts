import pino from 'pino';
import type { CanvasState } from '@claude-air/shared';
import { getDb } from '../db/database.js';

const log = pino({ name: 'canvas' });

export class CanvasService {
  /**
   * Get canvas state for a user.
   */
  get(userId: string): CanvasState {
    const db = getDb();
    const row = db.prepare('SELECT state_json FROM canvas_state WHERE user_id = ?').get(userId) as { state_json: string } | undefined;
    if (!row) {
      return { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } };
    }
    return JSON.parse(row.state_json) as CanvasState;
  }

  /**
   * Save canvas state for a user.
   */
  save(userId: string, state: CanvasState): void {
    const db = getDb();
    const json = JSON.stringify(state);
    db.prepare(`
      INSERT INTO canvas_state (user_id, state_json, updated_at) VALUES (?, ?, datetime('now'))
      ON CONFLICT(user_id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at
    `).run(userId, json);
    log.debug({ userId }, 'canvas state saved');
  }
}
