import type { LLMMessage, LLMProvider, LLMChatOptions } from "./providers.js";

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface OpenCodeProviderConfig {
  readonly baseUrl: string;
  readonly apiKey?: string;
  readonly model: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
}

export class OpenCodeProvider implements LLMProvider {
  readonly name = "opencode";
  private readonly config: OpenCodeProviderConfig;

  constructor(config: OpenCodeProviderConfig) {
    this.config = config;
  }

  async chat(messages: readonly LLMMessage[], options?: LLMChatOptions): Promise<string> {
    const model = options?.model ?? this.config.model;
    const url = `${this.config.baseUrl}/v1/chat/completions`;

    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (this.config.apiKey) {
      headers.authorization = `Bearer ${this.config.apiKey}`;
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model,
          messages: [...messages],
          temperature: options?.temperature ?? this.config.temperature ?? 0.7,
          max_tokens: options?.maxTokens ?? this.config.maxTokens ?? 1024,
          stream: false,
        }),
      });
    } catch (error) {
      throw new Error(`OpenCode chat request to ${url} failed: ${describe(error)}`);
    }

    if (!response.ok) {
      throw new Error(
        `OpenCode chat request to ${url} failed with status ${response.status} ${response.statusText}`
      );
    }

    let payload: { choices?: Array<{ message?: { content?: unknown } }>; error?: unknown };
    try {
      payload = (await response.json()) as typeof payload;
    } catch (error) {
      throw new Error(`OpenCode chat response from ${url} was not valid JSON: ${describe(error)}`);
    }

    if (payload.error !== undefined) {
      throw new Error(`OpenCode chat returned an error: ${String(payload.error)}`);
    }

    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new Error(
        `OpenCode chat response from ${url} did not include choices[0].message.content as a string`
      );
    }

    return content;
  }
}
