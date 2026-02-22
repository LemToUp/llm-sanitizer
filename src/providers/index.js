import { ChromeSummarizerProvider } from "./chrome-summarizer.js";
import { OpenAIAgentsProvider } from "./openai-agents.js";

/** All registered providers, keyed by id. */
export const providers = {
  [ChromeSummarizerProvider.id]: ChromeSummarizerProvider,
  [OpenAIAgentsProvider.id]: OpenAIAgentsProvider,
};

export const DEFAULT_PROVIDER = OpenAIAgentsProvider.id;

/**
 * Create a provider instance by id.
 * @param {string} id — provider key from `providers`
 * @param {Record<string, unknown>} settings — provider-specific settings
 * @returns {import('./provider.js').Provider}
 */
export function createProvider(id, settings = {}) {
  const ProviderClass = providers[id];
  if (!ProviderClass) {
    throw new Error(
      `Unknown provider: "${id}". Available: ${Object.keys(providers).join(", ")}`,
    );
  }
  return new ProviderClass(settings);
}
