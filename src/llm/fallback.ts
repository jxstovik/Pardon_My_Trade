import type { LLMMessage, LLMProvider, LLMChatOptions } from "./providers.js";

export interface FallbackProviderConfig {
  readonly providers: LLMProvider[];
  readonly onFallback?: (error: Error, provider: string, nextProvider: string) => void;
}

export class FallbackProvider implements LLMProvider {
  readonly name = "fallback";
  private readonly config: FallbackProviderConfig;

  constructor(config: FallbackProviderConfig) {
    this.config = config;
  }

  async chat(messages: readonly LLMMessage[], options?: LLMChatOptions): Promise<string> {
    let lastError: Error | undefined;

    for (let i = 0; i < this.config.providers.length; i++) {
      const provider = this.config.providers[i];
      const nextProvider = this.config.providers[i + 1];

      try {
        const result = await provider.chat(messages, options);
        return result;
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        lastError = err;

        if (nextProvider) {
          this.config.onFallback?.(err, provider.name, nextProvider.name);
          console.warn(
            `[FallbackProvider] ${provider.name} failed, trying ${nextProvider.name}: ${err.message}`
          );
        } else {
          console.error(`[FallbackProvider] ${provider.name} failed (no more providers): ${err.message}`);
        }
      }
    }

    throw new Error(
      `All LLM providers failed. Last error: ${lastError?.message ?? "unknown"}`
    );
  }
}

export function createFallbackChat(
  providers: LLMProvider[],
  onFallback?: (error: Error, provider: string, nextProvider: string) => void
): LLMProvider {
  return new FallbackProvider({ providers, onFallback });
}
