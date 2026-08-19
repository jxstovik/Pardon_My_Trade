# LLM Provider Configuration

This document describes the new LLM provider system with fallback support.

## Overview

The advisory chat system now supports multiple LLM providers with automatic fallback. If one provider fails, the system automatically tries the next provider in the chain.

## Default Fallback Chain

1. **OpenCode Zen** (Primary)
2. **OpenCode Go** (Secondary)
3. **OpenAI** (Tertiary)

## Configuration

Set the following environment variables in your `.env` file:

```bash
# OpenCode (Zen and Go models)
OPENCODE_BASE_URL=https://opencode.ai
OPENCODE_API_KEY=your-opencode-api-key
OPENCODE_ZEN_MODEL=zen
OPENCODE_GO_MODEL=go

# OpenAI (fallback)
OPENAI_BASE_URL=https://api.openai.com
OPENAI_API_KEY=your-openai-api-key
OPENAI_MODEL=gpt-4
```

## Customizing the Fallback Order

Edit `src/config/app-config.ts` to change the provider order:

```typescript
llm: {
  providers: [
    { name: "opencode-zen", ... },
    { name: "opencode-go", ... },
    { name: "openai", ... },
  ],
  fallbackOrder: ["opencode-zen", "opencode-go", "openai"],
}
```

## Adding New Providers

1. Create a new provider class in `src/llm/` implementing the `LLMProvider` interface
2. Add the provider to the switch statement in `src/llm/factory.ts`
3. Add the provider configuration to `src/config/app-config.ts`
4. Update the fallback order as needed

## Provider Interface

All providers must implement:

```typescript
interface LLMProvider {
  readonly name: string;
  chat(messages: readonly LLMMessage[], options?: LLMChatOptions): Promise<string>;
}
```

## Error Handling

- Failed providers are logged to console with a warning
- The fallback chain continues until a provider succeeds
- If all providers fail, an error is thrown with details about the last failure

## Migration from Ollama

The legacy Ollama configuration is preserved but deprecated. To migrate:

1. Set up your OpenCode and OpenAI API keys
2. Remove or comment out the `OLLAMA_*` environment variables
3. The system will automatically use the new fallback chain
