const mockTwitterApi = jest.fn();

jest.mock("twitter-api-v2", () => {
  const mockClient = {
    readWrite: {
      v2: {
        tweet: jest.fn(),
      },
    },
    readOnly: {},
  };

  return {
    TwitterApi: mockTwitterApi.mockImplementation(() => mockClient),
  };
});

jest.mock("../src/features/externalAPI/utils/apiHelper", () => ({
  writeFile: jest.fn(),
  readFile: jest.fn(),
  sendToClients: jest.fn(),
  generateSessionId: jest.fn(),
  sendError: jest.fn(),
}));

jest.mock("../src/utils/config", () => ({
  config: jest.fn(),
  defaults: {},
  prefixed: jest.fn((key: string) => key),
}));

const ORIGINAL_ENV = {
  X_API_KEY: process.env.X_API_KEY,
  X_API_SECRET: process.env.X_API_SECRET,
  X_ACCESS_TOKEN: process.env.X_ACCESS_TOKEN,
  X_ACCESS_SECRET: process.env.X_ACCESS_SECRET,
  X_BEARER_TOKEN: process.env.X_BEARER_TOKEN,
};

describe("Twitter isolation", () => {
  beforeEach(() => {
    mockTwitterApi.mockClear();
  });

  afterEach(() => {
    process.env.X_API_KEY = ORIGINAL_ENV.X_API_KEY;
    process.env.X_API_SECRET = ORIGINAL_ENV.X_API_SECRET;
    process.env.X_ACCESS_TOKEN = ORIGINAL_ENV.X_ACCESS_TOKEN;
    process.env.X_ACCESS_SECRET = ORIGINAL_ENV.X_ACCESS_SECRET;
    process.env.X_BEARER_TOKEN = ORIGINAL_ENV.X_BEARER_TOKEN;
  });

  it("imports dataHandler without instantiating Twitter", async () => {
    await jest.isolateModulesAsync(async () => {
      await import("@/pages/api/dataHandler");
    });

    expect(mockTwitterApi).not.toHaveBeenCalled();
  });

  it("returns a disabled result when Twitter credentials are placeholders", async () => {
    process.env.X_API_KEY = "default";
    process.env.X_API_SECRET = "default";
    process.env.X_ACCESS_TOKEN = "default";
    process.env.X_ACCESS_SECRET = "default";
    process.env.X_BEARER_TOKEN = "default";

    const { twitterClientInstance } = await import(
      "@/features/externalAPI/socialMedia/twitterClient"
    );

    const result = await twitterClientInstance.postTweet("hello");

    expect(result).toEqual(
      expect.objectContaining({
        status: "disabled",
      }),
    );
    expect(mockTwitterApi).not.toHaveBeenCalled();
  });
});
