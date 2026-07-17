import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";

const mockSendConversationControl = jest.fn(() => Promise.resolve("I started a fresh conversation."));
const mockReceiveMessageFromUser = jest.fn();
const mockUpdateAwake = jest.fn();
const mockAlertError = jest.fn();

jest.mock("@ricky0123/vad-react", () => ({
  useMicVAD: () => ({
    listening: false,
    userSpeaking: false,
    loading: false,
    errored: false,
    toggle: jest.fn(),
  }),
}));

jest.mock("../src/hooks/useTranscriber", () => ({
  useTranscriber: () => ({
    output: null,
    isBusy: false,
    isModelLoading: false,
    start: jest.fn(),
  }),
}));

jest.mock("../src/features/chat/deiphobeChat", () => ({
  sendDeiphobeConversationSegmentControl: (...args: unknown[]) => mockSendConversationControl(...args),
}));

jest.mock("../src/components/iconButton", () => ({
  IconButton: ({ iconName, label, onClick, disabled }: {
    iconName: string;
    label?: string;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" aria-label={label ?? iconName} disabled={disabled} onClick={onClick}>
      {label ?? iconName}
    </button>
  ),
}));

jest.mock("../src/utils/config", () => ({
  config: (key: string) => {
    const values: Record<string, string> = {
      chatbot_backend: "deiphobe",
      stt_backend: "none",
      amica_life_enabled: "false",
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
      amicaLife: {
        isMuted: () => false,
        toggleMute: jest.fn(),
        getRecorder: () => null,
        pause: jest.fn(),
      },
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

describe("MessageInput conversation controls", () => {
  const originalActEnv = (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mockSendConversationControl.mockClear();
    mockReceiveMessageFromUser.mockReset();
    mockUpdateAwake.mockReset();
    mockAlertError.mockReset();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = originalActEnv;
  });

  async function renderMessageInput(userMessage = "hello there") {
    const { ChatContext } = await import("../src/features/chat/chatContext");
    const { AlertContext } = await import("../src/features/alert/alertContext");
    const { AmicaLifeContext } = await import("../src/features/amicaLife/amicaLifeContext");
    const { AudioControlsContext } = await import("../src/features/moshi/components/audioControlsContext");
    const MessageInput = (await import("../src/components/messageInput")).default;

    const chatValue = {
      chat: {
        updateAwake: mockUpdateAwake,
        receiveMessageFromUser: mockReceiveMessageFromUser,
      },
    };
    const alertValue = { alert: { error: mockAlertError } };
    const amicaLifeValue = {
      amicaLife: {
        isMuted: () => false,
        toggleMute: jest.fn(),
        getRecorder: () => null,
        pause: jest.fn(),
      },
    };
    const audioControlsValue = {
      audioControls: {
        isMuted: () => false,
        toggleMute: jest.fn(),
        getRecorder: () => null,
      },
    };

    await act(async () => {
      root.render(
        <ChatContext.Provider value={chatValue as any}>
          <AlertContext.Provider value={alertValue as any}>
            <AmicaLifeContext.Provider value={amicaLifeValue as any}>
              <AudioControlsContext.Provider value={audioControlsValue as any}>
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

  test("new conversation sends typed flags and shows the deterministic status", async () => {
    await renderMessageInput();
    const buttons = Array.from(container.querySelectorAll("button"));
    const newConversationButton = buttons.find((button) => button.textContent === "New Conversation");
    expect(newConversationButton).toBeTruthy();

    await act(async () => {
      Simulate.click(newConversationButton!);
      await flush();
    });

    expect(mockSendConversationControl).toHaveBeenCalledWith({
      new_segment: true,
      continue_previous_segment: false,
    });
    expect(mockReceiveMessageFromUser).not.toHaveBeenCalled();
    expect(mockUpdateAwake).toHaveBeenCalled();
    expect(container.textContent).toContain("I started a fresh conversation.");
  });

  test("continue previous sends typed flags without touching the ordinary send path", async () => {
    await renderMessageInput("ordinary text");
    const buttons = Array.from(container.querySelectorAll("button"));
    const continueButton = buttons.find((button) => button.textContent === "Continue Previous");
    expect(continueButton).toBeTruthy();

    await act(async () => {
      Simulate.click(continueButton!);
      await flush();
    });

    expect(mockSendConversationControl).toHaveBeenCalledWith({
      new_segment: false,
      continue_previous_segment: true,
    });
    expect(mockReceiveMessageFromUser).not.toHaveBeenCalled();
    expect(container.textContent).toContain("I started a fresh conversation.");
  });

  test("ordinary send remains unchanged", async () => {
    await renderMessageInput("ordinary text");
    const sendButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "24/Send");
    expect(sendButton).toBeTruthy();

    await act(async () => {
      Simulate.click(sendButton!);
      await flush();
    });

    expect(mockReceiveMessageFromUser).toHaveBeenCalledWith("ordinary text", false);
    expect(mockSendConversationControl).not.toHaveBeenCalled();
  });
});
