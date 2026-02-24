import type { WsMessage } from '@claude-air/shared';

/**
 * Create a WebSocket connection for terminal I/O.
 * Returns the WebSocket instance for direct event handling.
 */
export function createTerminalWs(sessionId: string, token: string): WebSocket {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${location.host}/ws/terminal?sessionId=${encodeURIComponent(sessionId)}&token=${encodeURIComponent(token)}`;
  return new WebSocket(url);
}

export function sendTerminalInput(ws: WebSocket, sessionId: string, data: string): void {
  const msg: WsMessage = { type: 'terminal:input', sessionId, data };
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

export function sendTerminalResize(ws: WebSocket, sessionId: string, cols: number, rows: number): void {
  const msg: WsMessage = { type: 'terminal:resize', sessionId, cols, rows };
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}
