export interface LLMMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

export interface LLMProvider {
  readonly name: string;
  chat(messages: readonly LLMMessage[], options?: LLMChatOptions): Promise<string>;
}

export interface LLMChatOptions {
  readonly model?: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
}

export interface LLMProviderConfig {
  readonly baseUrl: string;
  readonly apiKey?: string;
  readonly model: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
}

export function isLLMError(error: unknown): error is Error {
  return error instanceof Error;
}
