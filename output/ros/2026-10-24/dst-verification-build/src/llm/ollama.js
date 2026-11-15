function describe(error) {
    return error instanceof Error ? error.message : String(error);
}
export async function ollamaChat(messages, options) {
    const baseUrl = options?.baseUrl ?? process.env.OLLAMA_BASE_URL ?? "https://ollama.cloud";
    const model = options?.model ?? process.env.OLLAMA_MODEL ?? "llama3";
    const apiKey = options?.apiKey ?? process.env.OLLAMA_API_KEY;
    const url = `${baseUrl}/api/chat`;
    const headers = { "content-type": "application/json" };
    if (apiKey)
        headers.authorization = `Bearer ${apiKey}`;
    let response;
    try {
        response = await fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify({ model, messages: [...messages], stream: false })
        });
    }
    catch (error) {
        throw new Error(`Ollama chat request to ${url} failed: ${describe(error)}`);
    }
    if (!response.ok) {
        throw new Error(`Ollama chat request to ${url} failed with status ${response.status} ${response.statusText}`);
    }
    let payload;
    try {
        payload = (await response.json());
    }
    catch (error) {
        throw new Error(`Ollama chat response from ${url} was not valid JSON: ${describe(error)}`);
    }
    if (payload.error !== undefined) {
        throw new Error(`Ollama chat returned an error: ${String(payload.error)}`);
    }
    const content = payload.message?.content;
    if (typeof content !== "string") {
        throw new Error(`Ollama chat response from ${url} did not include message.content as a string`);
    }
    return content;
}
