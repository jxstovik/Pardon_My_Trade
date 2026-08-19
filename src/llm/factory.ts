import type { LLMProvider } from "./providers.js";
import type { LLMProviderConfig } from "../config/app-config.js";
import { OpenCodeProvider } from "./opencode.js";
import { OpenAIProvider } from "./openai.js";
import { FallbackProvider } from "./fallback.js";

function createProvider(config: LLMProviderConfig): LLMProvider {
  switch (config.name) {
    case "opencode-zen":
    case "opencode-go":
      return new OpenCodeProvider({
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        model: config.model,
        temperature: config.temperature,
        maxTokens: config.maxTokens,
      });
    case "openai":
      return new OpenAIProvider({
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        model: config.model,
        temperature: config.temperature,
        maxTokens: config.maxTokens,
      });
    default:
      throw new Error(`Unknown LLM provider: ${config.name}`);
  }
}

export function buildLLMProvider(
  providers: LLMProviderConfig[],
  fallbackOrder: string[]
): LLMProvider {
  const providerMap = new Map<string, LLMProvider>();
  for (const config of providers) {
    providerMap.set(config.name, createProvider(config));
  }

  const orderedProviders: LLMProvider[] = [];
  for (const name of fallbackOrder) {
    const provider = providerMap.get(name);
    if (provider) {
      orderedProviders.push(provider);
    } else {
      console.warn(`[LLM] Provider "${name}" not found in config, skipping`);
    }
  }

  if (orderedProviders.length === 0) {
    throw new Error("No LLM providers configured");
  }

  if (orderedProviders.length === 1) {
    return orderedProviders[0];
  }

  return new FallbackProvider({
    providers: orderedProviders,
    onFallback: (error, provider, nextProvider) => {
      console.warn(`[LLM] Falling back from ${provider} to ${nextProvider}: ${error.message}`);
    },
  });
}
