/**
 * Dev instance registration — servers write their PID/port to .dev-instances.json
 * so the kill script can reliably find and terminate them.
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface InstanceEntry {
  pid: number;
  port: number;
  name: string;
  startedAt: string;
}

type InstanceFile = Record<string, InstanceEntry>;

function instanceFilePath(callerUrl: string): string {
  // callerUrl is import.meta.url from the calling server
  // Both servers live at packages/<name>/src/index.ts → root is 3 levels up
  return resolve(dirname(fileURLToPath(callerUrl)), '..', '..', '..', '.dev-instances.json');
}

export function registerInstance(name: string, port: number, callerUrl: string): void {
  const filePath = instanceFilePath(callerUrl);
  let instances: InstanceFile = {};
  try { instances = JSON.parse(readFileSync(filePath, 'utf-8')); } catch { /* new file */ }
  instances[name] = { pid: process.pid, port, name, startedAt: new Date().toISOString() };
  try { writeFileSync(filePath, JSON.stringify(instances, null, 2) + '\n'); } catch { /* ignore */ }
}

export function deregisterInstance(name: string, callerUrl: string): void {
  const filePath = instanceFilePath(callerUrl);
  try {
    const instances: InstanceFile = JSON.parse(readFileSync(filePath, 'utf-8'));
    delete instances[name];
    if (Object.keys(instances).length === 0) {
      writeFileSync(filePath, '{}\n');
    } else {
      writeFileSync(filePath, JSON.stringify(instances, null, 2) + '\n');
    }
  } catch { /* ignore */ }
}
