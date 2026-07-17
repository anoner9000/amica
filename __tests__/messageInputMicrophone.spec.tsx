/**
 * Microphone button behavior in the composer: failures surface actionable
 * guidance, never permanently disable the button, never clear composer text,
 * never emit chat/TTS/config requests, and capture stops on unmount.
 */
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";

const mockReceiveMessageFromUser = jest.fn();
const mockUpdateAwake = jest.fn();
const mockAlertError = jest.fn();

const mockStart = jest.fn<(opts: any) => Promise<any>>();
const mockStop = jest.fn();
let mockActive = false;

jest.mock("../src/features/microphone/microphoneCapture", () => ({
  MicrophoneCapture: class {
    get isActive() {
      return mockActive;
    }
    get isStarting() {
      return false;
    }
    start(opts: any) {
      return mockStart(opts);
    }
    stop() {
      mockActive = false;
      mockStop();
    }
  },
}));

jest.mock("../src/hooks/useTranscriber", () => ({
  useTranscriber: () => ({
    output: null,
    isBusy: false,
    isModelLoading: false,
    start: jest.fn(),
  }),
}));

jest.mock("../src/components/iconButton", () => ({
  IconButton: ({ iconName, label, onClick, disabled, isProcessing }: any) => (
    <button
      type="button"
      aria-label={label ?? iconName}
      disabled={disabled}
      data-processing={String(Boolean(isProcessing))}
      onClick={onClick}
    >
      {iconName}
    </button>
  ),
}));

jest.mock("../src/utils/config", () => ({
  config: (key: string) => {
    const values: Record<string, string> = {
      chatbot_backend: "deiphobe",
      stt_backend: "whisper_browser",
      amica_life_enabled: "false",
      wake_word_enabled: "false",
      autosend_from_mic: "true",
    };
    return values[key] ?? "";
  },
}));

jest.mock("../src/features/alert/alertContext", () => {
  const { createContext } = require("react");
  return {
    AlertContext: createContext({ alert: { error: mockAlertError } }),
  };
});

jest.mock("../src/features/chat/chatContext", () => {
  const { createContext } = require("react");
  return {
    ChatContext: createContext({
      chat: {
        updateAwake: mockUpdateAwake,
        receiveMessageFromUser: mockReceiveMessageFromUser,
      },
    }),
  };
});

jest.mock("../src/features/amicaLife/amicaLifeContext", () => {
  const { createContext } = require("react");
  return {
    AmicaLifeContext: createContext({
      amicaLife: { pause: jest.fn() },
    }),
  };
});

jest.mock("../src/features/moshi/components/audioControlsContext", () => {
  const { createContext } = require("react");
  return {
    AudioControlsContext: createContext({
      audioControls: {
        isMuted: () => false,
        toggleMute: jest.fn(),
        getRecorder: () => null,
      },
    }),
  };
});

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const PERMISSION_FAILURE = {
  failureClass: "permission_denied",
  guidance:
    "Microphone access is blocked for this site. Allow Microphone in your " +
    "browser's site settings (Brave: the shield/lock icon in the address bar), then try again.",
  errorName: "NotAllowedError",
  environment: {
    origin: "http://littledebbie:3002",
    secureContext: false,
    apiAvailable: false,
    permission: null,
    policyAllowed: null,
  },
};

describe("MessageInput microphone", () => {
  const originalActEnv = (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let fetchSpy: ReturnType<typeof jest.fn>;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mockReceiveMessageFromUser.mockReset();
    mockAlertError.mockReset();
    mockStart.mockReset();
    mockStop.mockReset();
    mockActive = false;
    fetchSpy = jest.fn();
    (global as any).fetch = fetchSpy;
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = originalActEnv;
  });

  async function renderComposer(userMessage = "draft text stays") {
    const { ChatContext } = await import("../src/features/chat/chatContext");
    const { AlertContext } = await import("../src/features/alert/alertContext");
    const { AmicaLifeContext } = await import("../src/features/amicaLife/amicaLifeContext");
    const { AudioControlsContext } = await import("../src/features/moshi/components/audioControlsContext");
    const MessageInput = (await import("../src/components/messageInput")).default;

    await act(async () => {
      root.render(
        <ChatContext.Provider value={{ chat: { updateAwake: mockUpdateAwake, receiveMessageFromUser: mockReceiveMessageFromUser } } as any}>
          <AlertContext.Provider value={{ alert: { error: mockAlertError } } as any}>
            <AmicaLifeContext.Provider value={{ amicaLife: { pause: jest.fn() } } as any}>
              <AudioControlsContext.Provider value={{ audioControls: { isMuted: () => false, toggleMute: jest.fn(), getRecorder: () => null } } as any}>
                <MessageInput
                  userMessage={userMessage}
                  setUserMessage={jest.fn()}
                  isChatProcessing={false}
                  onChangeUserMessage={jest.fn()}
                />
              </AudioControlsContext.Provider>
            </AmicaLifeContext.Provider>
          </AlertContext.Provider>
        </ChatContext.Provider>,
      );
      await flush();
    });
  }

  function micButton(): HTMLButtonElement {
    return container.querySelector(
      "button[aria-label='Microphone']",
    ) as HTMLButtonElement;
  }

  test("mount performs no capture and no requests", async () => {
    await renderComposer();
    expect(mockStart).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(micButton().disabled).toBe(false);
  });

  test("failure shows actionable guidance and the button stays enabled for retry", async () => {
    mockStart.mockResolvedValue(PERMISSION_FAILURE);
    await renderComposer();

    await act(async () => {
      Simulate.click(micButton());
      await flush();
    });

    expect(mockAlertError).toHaveBeenCalledWith(
      "Microphone",
      expect.stringContaining("site settings"),
    );
    expect(micButton().disabled).toBe(false);

    // Second click retries capture instead of being poisoned.
    await act(async () => {
      Simulate.click(micButton());
      await flush();
    });
    expect(mockStart).toHaveBeenCalledTimes(2);
  });

  test("failure preserves composer text and produces no chat, TTS, or config request", async () => {
    mockStart.mockResolvedValue(PERMISSION_FAILURE);
    await renderComposer("draft text stays");

    await act(async () => {
      Simulate.click(micButton());
      await flush();
    });

    const input = container.querySelector("input[type='text']") as HTMLInputElement;
    expect(input.value).toBe("draft text stays");
    expect(mockReceiveMessageFromUser).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("successful capture toggles to listening; second click stops it", async () => {
    mockStart.mockImplementation(async () => {
      mockActive = true;
      return null;
    });
    await renderComposer();

    await act(async () => {
      Simulate.click(micButton());
      await flush();
    });
    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(micButton().textContent).toBe("24/PauseAlt");

    await act(async () => {
      Simulate.click(micButton());
      await flush();
    });
    expect(mockStop).toHaveBeenCalledTimes(1);
    expect(micButton().textContent).toBe("24/Microphone");
  });

  test("remount does not permanently disable capture", async () => {
    mockStart.mockResolvedValue(PERMISSION_FAILURE);
    await renderComposer();
    await act(async () => {
      Simulate.click(micButton());
      await flush();
    });

    act(() => {
      root.unmount();
    });
    root = createRoot(container);
    await renderComposer();

    expect(micButton().disabled).toBe(false);
    mockStart.mockImplementation(async () => {
      mockActive = true;
      return null;
    });
    await act(async () => {
      Simulate.click(micButton());
      await flush();
    });
    expect(micButton().textContent).toBe("24/PauseAlt");
  });

  test("unmount stops any active capture", async () => {
    mockStart.mockImplementation(async () => {
      mockActive = true;
      return null;
    });
    await renderComposer();
    await act(async () => {
      Simulate.click(micButton());
      await flush();
    });

    act(() => {
      root.unmount();
    });
    root = createRoot(container);
    expect(mockStop).toHaveBeenCalled();
  });
});
