import pino from 'pino';
import { config } from '../config.js';

const log = pino({ name: 'sms-proxy' });

/**
 * Proxy service for communicating with the Session Manager Server (SMS).
 * All REST calls to SMS go through this service.
 */
export class SmsProxy {
  private baseUrl: string;

  constructor() {
    this.baseUrl = config.smsUrl;
  }

  /**
   * Generic fetch wrapper for SMS API calls.
   */
  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    try {
      const res = await fetch(url, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          ...init?.headers,
        },
      });
      const data = await res.json() as Record<string, unknown>;
      if (!res.ok) {
        throw new Error((data.error as string) || `SMS returned ${res.status}`);
      }
      return data as T;
    } catch (err) {
      log.error({ err, path }, 'SMS proxy request failed');
      throw err;
    }
  }

  // ── Sessions ──

  async listSessions() {
    return this.request('/api/sessions');
  }

  async getSession(id: string) {
    return this.request(`/api/sessions/${encodeURIComponent(id)}`);
  }

  async createSession(body: { name: string; workspacePath: string; type?: string; skipPermissions?: boolean; claudeArgs?: string; claudeResumeId?: string; backend?: string }) {
    return this.request('/api/sessions', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async killSession(id: string) {
    return this.request(`/api/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  async renameSession(id: string, name: string) {
    return this.request(`/api/sessions/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify({ name }),
    });
  }

  async sendKeys(id: string, keys: string) {
    return this.request(`/api/sessions/${encodeURIComponent(id)}/send`, {
      method: 'POST',
      body: JSON.stringify({ keys }),
    });
  }

  async reattachSession(id: string) {
    return this.request(`/api/sessions/${encodeURIComponent(id)}/reattach`, { method: 'POST' });
  }

  async captureOutput(id: string, lines = 100) {
    return this.request(`/api/sessions/${encodeURIComponent(id)}/output?lines=${lines}`);
  }

  /**
   * Upload a pasted image to SMS, bypassing the JSON request() wrapper.
   */
  async uploadImage(sessionId: string, buffer: Buffer, contentType: string) {
    const url = `${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/paste-image`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': contentType },
        body: buffer,
      });
      const data = await res.json() as Record<string, unknown>;
      if (!res.ok) {
        throw new Error((data.error as string) || `SMS returned ${res.status}`);
      }
      return data;
    } catch (err) {
      log.error({ err, sessionId }, 'SMS uploadImage failed');
      throw err;
    }
  }

  // ── Health ──

  async health() {
    return this.request('/api/health');
  }

  /**
   * Get the WebSocket URL for a session terminal.
   */
  getTerminalWsUrl(sessionId: string): string {
    const wsBase = this.baseUrl.replace(/^http/, 'ws');
    return `${wsBase}/ws/terminal?sessionId=${encodeURIComponent(sessionId)}`;
  }
}
