import { twitterClientInstance as twitterClient } from "../socialMedia/twitterClient";
import { telegramClientInstance as telegramClient } from "../socialMedia/telegramClient";
import { sendToClients } from "./apiHelper";

type MessageMeta = { voice_posture?: string; animation_state?: string };

export const handleSocialMediaActions = async (
  message: string,
  socialMedia: string,
  meta?: MessageMeta,
): Promise<any> => {
  switch (socialMedia) {
    case "twitter":
      return await twitterClient.postTweet(message);
    case "tg":
      return await telegramClient.postMessage(message);
    case "none":
      sendToClients({ type: "normal", data: { text: message, ...meta } });
      return "Broadcasted to clients";
    default:
      throw new Error("No action taken for social media.");
  }
};
