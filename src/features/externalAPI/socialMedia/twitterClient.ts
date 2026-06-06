import { TwitterApi, TwitterApiReadWrite, TwitterApiReadOnly, TweetV2PostTweetResult } from 'twitter-api-v2';

type TwitterConfig = {
  appKey: string;
  appSecret: string;
  accessToken: string;
  accessSecret: string;
  bearerToken: string;
};

type TwitterDisabledResult = {
  status: "disabled";
  reason: string;
};

type TwitterSuccessResult = {
  status: "sent";
  response: TweetV2PostTweetResult;
};

type TwitterErrorResult = {
  status: "error";
  reason: string;
};

export type TwitterPostResult = TwitterDisabledResult | TwitterSuccessResult | TwitterErrorResult;

const PLACEHOLDER_TOKENS = new Set([
  "default",
  "placeholder",
  "changeme",
  "change-me",
  "replace_me",
  "replace-me",
  "your_token_here",
  "your_token",
  "your-key-here",
  "your_secret_here",
]);

class TwitterClient {
  private twitterClient: TwitterApiReadWrite | null = null;
  private twitterBearer: TwitterApiReadOnly | null = null;
  private initError: string | null = null;

  private normalizeToken(value: string | undefined): string {
    return (value ?? "").trim();
  }

  private isPlaceholderToken(value: string): boolean {
    const normalized = value.toLowerCase();
    return PLACEHOLDER_TOKENS.has(normalized) || normalized.includes("your_") || normalized.includes("placeholder");
  }

  private getConfig(): TwitterConfig | null {
    const appKey = this.normalizeToken(process.env.X_API_KEY);
    const appSecret = this.normalizeToken(process.env.X_API_SECRET);
    const accessToken = this.normalizeToken(process.env.X_ACCESS_TOKEN);
    const accessSecret = this.normalizeToken(process.env.X_ACCESS_SECRET);
    const bearerToken = this.normalizeToken(process.env.X_BEARER_TOKEN);

    const requiredTokens = [
      ["X_API_KEY", appKey],
      ["X_API_SECRET", appSecret],
      ["X_ACCESS_TOKEN", accessToken],
      ["X_ACCESS_SECRET", accessSecret],
      ["X_BEARER_TOKEN", bearerToken],
    ] as const;

    const missingToken = requiredTokens.find(([, value]) => !value);
    if (missingToken) {
      this.initError = `Twitter disabled: missing ${missingToken[0]}.`;
      return null;
    }

    const placeholderToken = requiredTokens.find(([, value]) => this.isPlaceholderToken(value));
    if (placeholderToken) {
      this.initError = `Twitter disabled: placeholder ${placeholderToken[0]}.`;
      return null;
    }

    return {
      appKey,
      appSecret,
      accessToken,
      accessSecret,
      bearerToken,
    };
  }

  private ensureClients(): boolean {
    if (this.twitterClient && this.twitterBearer) {
      return true;
    }

    if (this.initError) {
      return false;
    }

    const config = this.getConfig();
    if (!config) {
      return false;
    }

    try {
      const client = new TwitterApi({
        appKey: config.appKey,
        appSecret: config.appSecret,
        accessToken: config.accessToken,
        accessSecret: config.accessSecret,
      });

      const bearer = new TwitterApi(config.bearerToken);

      this.twitterClient = client.readWrite;
      this.twitterBearer = bearer.readOnly;
      return true;
    } catch (error) {
      this.initError = `Twitter disabled: failed to initialize client (${String(error)}).`;
      console.warn(this.initError);
      return false;
    }
  }

  // Method to get the read-write client
  public getReadWriteClient(): TwitterApiReadWrite | null {
    if (!this.ensureClients()) {
      return null;
    }
    return this.twitterClient;
  }

  // Method to get the read-only client
  public getReadOnlyClient(): TwitterApiReadOnly | null {
    if (!this.ensureClients()) {
      return null;
    }
    return this.twitterBearer;
  }

  // Function to post a tweet
  public async postTweet(content: string): Promise<TwitterPostResult> {
    if (!this.ensureClients()) {
      return {
        status: "disabled",
        reason: this.initError ?? "Twitter disabled: unavailable configuration.",
      };
    }

    try {
      const response = await this.twitterClient!.v2.tweet(content);
      return {
        status: "sent",
        response,
      };
    } catch (error) {
      const reason = `Twitter tweet failed: ${String(error)}`;
      console.error(reason);
      return {
        status: "error",
        reason,
      };
    }
  }
}

// Export an instance of the TwitterClient class for use
export const twitterClientInstance = new TwitterClient();
