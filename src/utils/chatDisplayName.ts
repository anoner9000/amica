import { config } from "@/utils/config";

export function getAssistantChatDisplayName(): string {
  const backend = config("chatbot_backend").trim().toLowerCase();
  if (backend === "deiphobe") {
    return "Deiphobe";
  }

  return config("name").toUpperCase();
}
