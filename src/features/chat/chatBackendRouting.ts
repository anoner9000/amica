export function shouldUseReasoningEngine(
  chatbotBackend: string,
  reasoningEngineEnabled: string,
): boolean {
  if (chatbotBackend === "deiphobe") {
    return false;
  }

  return reasoningEngineEnabled === "true";
}
