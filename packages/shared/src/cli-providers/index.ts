import type { CliProvider, CliProviderId } from './types.js';
import { claudeProvider } from './claude.js';
import { geminiProvider } from './gemini.js';

export type { CliProvider, CliProviderId, CliCommandOptions } from './types.js';

const providers: Record<CliProviderId, CliProvider> = {
  claude: claudeProvider,
  gemini: geminiProvider,
};

export const DEFAULT_CLI_PROVIDER: CliProviderId = 'claude';

export function getCliProvider(id: CliProviderId): CliProvider {
  const provider = providers[id];
  if (!provider) throw new Error(`Unknown CLI provider: ${id}`);
  return provider;
}

export function getAllCliProviders(): CliProvider[] {
  return Object.values(providers);
}
