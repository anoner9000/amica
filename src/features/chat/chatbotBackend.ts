const BACKEND_ALIASES: Record<string, string> = {
  openai: "chatgpt",
  gpt: "chatgpt",
  "llama_cpp": "llamacpp",
  "llama-cpp": "llamacpp",
  "llama.cpp": "llamacpp",
};

const KNOWN_BACKENDS = new Set([
  "echo",
  "arbius_llm",
  "chatgpt",
  "deiphobe",
  "llamacpp",
  "windowai",
  "ollama",
  "koboldai",
  "moshi",
  "openrouter",
]);

export function normalizeChatbotBackend(value: string): string {
  const normalized = (value ?? "").trim().toLowerCase();
  if (!normalized) {
    return "echo";
  }

  const alias = BACKEND_ALIASES[normalized];
  if (alias) {
    return alias;
  }

  if (KNOWN_BACKENDS.has(normalized)) {
    return normalized;
  }

  return normalized;
}
