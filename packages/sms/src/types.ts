export interface PaneInfo {
  id: string;        // e.g. "%0"
  sessionName: string;
  windowIndex: number;
  paneIndex: number;
  width: number;
  height: number;
  active: boolean;
}

export interface TmuxControlEvent {
  type: 'output' | 'session-changed' | 'window-renamed' | 'pane-exited' |
        'begin' | 'end' | 'error' | 'layout-changed' | 'session-window-changed';
  paneId?: string;
  sessionId?: string;
  name?: string;
  data?: string;
  exitCode?: number;
  commandTag?: number;
}

export interface ScrollbackBuffer {
  lines: string[];
  maxSize: number;
  push(line: string): void;
  getAll(): string[];
  clear(): void;
}
