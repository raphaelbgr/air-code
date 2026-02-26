import { Router, type Request, type Response } from 'express';
import { platform, release, version, hostname } from 'node:os';
import { readFileSync } from 'node:fs';
import type { HealthResponse } from '@claude-air/shared';
import { VERSION } from '@claude-air/shared';
import { SessionService } from '../services/session.service.js';

const startTime = Date.now();

function detectOS(): string {
  const p = platform();
  if (p === 'win32') {
    // e.g. "10.0.22631" → Windows 11 (build 22000+)
    const rel = release();
    const build = parseInt(rel.split('.')[2] || '0', 10);
    return build >= 22000 ? 'Windows 11' : 'Windows 10';
  }
  if (p === 'darwin') {
    // e.g. version() may contain "Version 15.2" or similar
    const ver = release(); // kernel version like "24.3.0"
    const major = parseInt(ver.split('.')[0] || '0', 10);
    // Map Darwin kernel major → macOS name
    const macNames: Record<number, string> = {
      24: 'Sequoia', 23: 'Sonoma', 22: 'Ventura', 21: 'Monterey',
      20: 'Big Sur', 19: 'Catalina', 18: 'Mojave',
    };
    const name = macNames[major] || '';
    return name ? `macOS ${name}` : 'macOS';
  }
  if (p === 'linux') {
    // Try /etc/os-release for distro info
    try {
      const osRelease = readFileSync('/etc/os-release', 'utf-8');
      const match = osRelease.match(/^PRETTY_NAME="?([^"\n]+)"?/m);
      if (match) return match[1];
    } catch { /* not available */ }
    return `Linux ${release()}`;
  }
  return p;
}

const osLabel = detectOS();
const hostName = hostname();

export function createHealthRoutes(sessionService: SessionService): Router {
  const router = Router();

  router.get('/', (_req: Request, res: Response) => {
    const tmuxOk = sessionService.checkTmux();
    const response = {
      status: tmuxOk ? 'ok' : (sessionService.isMockMode ? 'ok' : 'degraded'),
      version: VERSION,
      uptime: Math.floor((Date.now() - startTime) / 1000),
      mock: sessionService.isMockMode,
      os: osLabel,
      hostname: hostName,
    };
    res.json(response);
  });

  return router;
}
