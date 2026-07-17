import {
  ConfigConflictError,
  handleConfig,
  serverConfig,
  serverConfigRevision,
} from "@/features/externalAPI/externalAPI";
import { alert } from "@/features/alert/alertContext";
import { normalizeChatbotBackend } from "@/features/chat/chatbotBackend";
import { resolveHostAwareLocalUrl } from "@/utils/hostAwareUrl";

export const defaults = {
  // AllTalk TTS specific settings
  localXTTS_url: process.env.NEXT_PUBLIC_LOCALXTTS_URL ?? 'http://127.0.0.1:7851',
  alltalk_version: process.env.NEXT_PUBLIC_ALLTALK_VERSION ?? 'v2',
  alltalk_voice: process.env.NEXT_PUBLIC_ALLTALK_VOICE ?? 'female_01.wav',
  alltalk_language: process.env.NEXT_PUBLIC_ALLTALK_LANGUAGE ?? 'en',
  alltalk_rvc_voice: process.env.NEXT_PUBLIC_ALLTALK_RVC_VOICE ?? 'Disabled',
  alltalk_rvc_pitch: process.env.NEXT_PUBLIC_ALLTALK_RVC_PITCH ?? '0',
  autosend_from_mic: 'true',
  wake_word_enabled: 'false',
  wake_word: 'Hello',
  time_before_idle_sec: '20',
  debug_gfx: 'false',
  use_webgpu: 'false',
  mtoon_debug_mode: 'none',
  mtoon_material_type: 'mtoon',
  language: process.env.NEXT_PUBLIC_LANGUAGE ?? 'en',
  show_introduction: process.env.NEXT_PUBLIC_SHOW_INTRODUCTION ?? 'true',
  show_arbius_introduction: process.env.NEXT_PUBLIC_SHOW_ARBIUS_INTRODUCTION ?? 'false',
  show_add_to_homescreen: process.env.NEXT_PUBLIC_SHOW_ADD_TO_HOMESCREEN ?? 'true',
  bg_color: process.env.NEXT_PUBLIC_BG_COLOR ?? '',
  bg_url: process.env.NEXT_PUBLIC_BG_URL ?? '/bg/bg-room2.jpg',
  vrm_url: process.env.NEXT_PUBLIC_VRM_HASH ?? '/vrm/AvatarSample_A.vrm',
  vrm_hash: '',
  vrm_save_type: 'web',
  youtube_videoid: '',
  animation_url: process.env.NEXT_PUBLIC_ANIMATION_URL ?? '/animations/idle_loop.vrma',
  animation_procedural: process.env.NEXT_PUBLIC_ANIMATION_PROCEDURAL ?? 'false',
  voice_url: process.env.NEXT_PUBLIC_VOICE_URL ?? '',
  chatbot_backend: process.env.NEXT_PUBLIC_CHATBOT_BACKEND ?? 'deiphobe',
  arbius_llm_model_id: process.env.NEXT_PUBLIC_ARBIUS_LLM_MODEL_ID ?? 'default',
  openai_apikey: process.env.NEXT_PUBLIC_OPENAI_APIKEY ?? 'default',
  openai_url: process.env.NEXT_PUBLIC_OPENAI_URL ?? 'https://i-love-amica.com',
  openai_model: process.env.NEXT_PUBLIC_OPENAI_MODEL ?? 'mlabonne/NeuralDaredevil-8B-abliterated',
  deiphobe_repo_root: process.env.NEXT_PUBLIC_DEIPHOBE_REPO_ROOT ?? '/home/kyler/ClawDawg',
  deiphobe_command: process.env.NEXT_PUBLIC_DEIPHOBE_COMMAND ?? './ops/scripts/bus/deiphobe',
  deiphobe_user_id: process.env.NEXT_PUBLIC_DEIPHOBE_USER_ID ?? 'uther-voice',
  deiphobe_session_id: process.env.NEXT_PUBLIC_DEIPHOBE_SESSION_ID ?? 'voice-avatar-test',
  deiphobe_namespace: process.env.NEXT_PUBLIC_DEIPHOBE_NAMESPACE ?? 'voice',
  deiphobe_timeout_seconds: process.env.NEXT_PUBLIC_DEIPHOBE_TIMEOUT_SECONDS ?? '120',
  deiphobe_private_mode: process.env.NEXT_PUBLIC_DEIPHOBE_PRIVATE_MODE ?? 'false',
  deiphobe_private_memory_root: process.env.NEXT_PUBLIC_DEIPHOBE_PRIVATE_MEMORY_ROOT ?? '',
  deiphobe_chat_num_predict: process.env.NEXT_PUBLIC_DEIPHOBE_CHAT_NUM_PREDICT ?? '',
  deiphobe_speech_autoplay_enabled: process.env.NEXT_PUBLIC_DEIPHOBE_SPEECH_AUTOPLAY_ENABLED ?? 'false',
  deiphobe_speech_provider: process.env.NEXT_PUBLIC_DEIPHOBE_SPEECH_PROVIDER ?? 'xtts_stream',
  llamacpp_url: process.env.NEXT_PUBLIC_LLAMACPP_URL ?? 'http://127.0.0.1:8080',
  llamacpp_stop_sequence: process.env.NEXT_PUBLIC_LLAMACPP_STOP_SEQUENCE ?? '(End)||[END]||Note||***||You:||User:||</s>',
  ollama_url: process.env.NEXT_PUBLIC_OLLAMA_URL ?? 'http://localhost:11434',
  ollama_model: process.env.NEXT_PUBLIC_OLLAMA_MODEL ?? 'llama2',
  koboldai_url: process.env.NEXT_PUBLIC_KOBOLDAI_URL ?? 'http://localhost:5001',
  koboldai_use_extra: process.env.NEXT_PUBLIC_KOBOLDAI_USE_EXTRA ?? 'false',
  koboldai_stop_sequence: process.env.NEXT_PUBLIC_KOBOLDAI_STOP_SEQUENCE ?? '(End)||[END]||Note||***||You:||User:||</s>',
  moshi_url: process.env.NEXT_PUBLIC_MOSHI_URL ?? 'https://runpod.proxy.net',
  openrouter_apikey: process.env.NEXT_PUBLIC_OPENROUTER_APIKEY ?? '',
  openrouter_url: process.env.NEXT_PUBLIC_OPENROUTER_URL ?? 'https://openrouter.ai/api/v1',
  openrouter_model: process.env.NEXT_PUBLIC_OPENROUTER_MODEL ?? 'openai/gpt-3.5-turbo',
  tts_muted: 'false',
  tts_volume: process.env.NEXT_PUBLIC_TTS_VOLUME ?? '0.6',
  tts_backend: process.env.NEXT_PUBLIC_TTS_BACKEND ?? 'piper',
  stt_backend: process.env.NEXT_PUBLIC_STT_BACKEND ?? 'whisper_browser',
  vision_backend: process.env.NEXT_PUBLIC_VISION_BACKEND ?? 'vision_openai',
  vision_system_prompt: process.env.NEXT_PUBLIC_VISION_SYSTEM_PROMPT ?? `Look at the image as you would if you are a human, be concise, witty and charming.`,
  vision_openai_apikey: process.env.NEXT_PUBLIC_VISION_OPENAI_APIKEY ?? 'default',
  vision_openai_url: process.env.NEXT_PUBLIC_VISION_OPENAI_URL ?? 'https://api-01.heyamica.com',
  vision_openai_model: process.env.NEXT_PUBLIC_VISION_OPENAI_URL ?? 'gpt-4-vision-preview',
  vision_llamacpp_url: process.env.NEXT_PUBLIC_VISION_LLAMACPP_URL ?? 'http://127.0.0.1:8081',
  vision_ollama_url: process.env.NEXT_PUBLIC_VISION_OLLAMA_URL ?? 'http://localhost:11434',
  vision_ollama_model: process.env.NEXT_PUBLIC_VISION_OLLAMA_MODEL ?? 'llava',
  whispercpp_url: process.env.NEXT_PUBLIC_WHISPERCPP_URL ?? 'http://localhost:8080',
  openai_whisper_apikey: process.env.NEXT_PUBLIC_OPENAI_WHISPER_APIKEY ?? '',
  openai_whisper_url: process.env.NEXT_PUBLIC_OPENAI_WHISPER_URL ?? 'https://api.openai.com',
  openai_whisper_model: process.env.NEXT_PUBLIC_OPENAI_WHISPER_MODEL ?? 'whisper-1',
  openai_tts_apikey: process.env.NEXT_PUBLIC_OPENAI_TTS_APIKEY ?? '',
  openai_tts_url: process.env.NEXT_PUBLIC_OPENAI_TTS_URL ?? 'https://api.openai.com',
  openai_tts_model: process.env.NEXT_PUBLIC_OPENAI_TTS_MODEL ?? 'tts-1',
  openai_tts_voice: process.env.NEXT_PUBLIC_OPENAI_TTS_VOICE ?? 'nova',
  rvc_url: process.env.NEXT_PUBLIC_RVC_URL ?? 'http://localhost:8001/voice2voice',
  rvc_enabled: process.env.NEXT_PUBLIC_RVC_ENABLED ?? 'false',
  rvc_model_name: process.env.NEXT_PUBLIC_RVC_MODEL_NAME ?? 'model_name.pth',
  rvc_f0_upkey: process.env.NEXT_PUBLIC_RVC_F0_UPKEY ?? '0',
  rvc_f0_method: process.env.NEXT_PUBLIC_RVC_METHOD ?? 'pm',
  rvc_index_path: process.env.NEXT_PUBLIC_RVC_INDEX_PATH ?? 'none',
  rvc_index_rate: process.env.NEXT_PUBLIC_RVC_INDEX_RATE ?? '0.66',
  rvc_filter_radius: process.env.NEXT_PUBLIC_RVC_FILTER_RADIUS ?? '3',
  rvc_resample_sr: process.env.NEXT_PUBLIC_RVC_RESAMPLE_SR ?? '0',
  rvc_rms_mix_rate: process.env.NEXT_PUBLIC_RVC_RMS_MIX_RATE ?? '1',
  rvc_protect: process.env.NEXT_PUBLIC_RVC_PROTECT ?? '0.33',
  coquiLocal_url: process.env.NEXT_PUBLIC_COQUILOCAL_URL ?? 'http://localhost:5002',
  coquiLocal_voiceid: process.env.NEXT_PUBLIC_COQUILOCAL_VOICEID ?? 'p240',
  kokoro_url: process.env.NEXT_PUBLIC_KOKORO_URL ?? 'http://localhost:8080',
  kokoro_voice: process.env.NEXT_PUBLIC_KOKORO_VOICE ?? 'af_bella',
  piper_url: process.env.NEXT_PUBLIC_PIPER_URL ?? 'http://127.0.0.1:5000/tts',
  elevenlabs_apikey: process.env.NEXT_PUBLIC_ELEVENLABS_APIKEY ??'',
  elevenlabs_voiceid: process.env.NEXT_PUBLIC_ELEVENLABS_VOICEID ?? '21m00Tcm4TlvDq8ikWAM',
  elevenlabs_model: process.env.NEXT_PUBLIC_ELEVENLABS_MODEL ?? 'eleven_monolingual_v1',
  speecht5_speaker_embedding_url: process.env.NEXT_PUBLIC_SPEECHT5_SPEAKER_EMBEDDING_URL ?? '/speecht5_speaker_embeddings/cmu_us_slt_arctic-wav-arctic_a0001.bin',
  coqui_apikey: process.env.NEXT_PUBLIC_COQUI_APIKEY ?? "",
  coqui_voice_id: process.env.NEXT_PUBLIC_COQUI_VOICEID ?? "71c6c3eb-98ca-4a05-8d6b-f8c2b5f9f3a3",
  deiphobe_speech_prerender_enabled: process.env.NEXT_PUBLIC_DEIPHOBE_SPEECH_PRERENDER_ENABLED ?? 'false',
  deiphobe_speech_chat_controls_enabled: process.env.NEXT_PUBLIC_DEIPHOBE_SPEECH_CHAT_CONTROLS_ENABLED ?? 'false',
  deiphobe_speech_auto_render_enabled: process.env.NEXT_PUBLIC_DEIPHOBE_SPEECH_AUTO_RENDER_ENABLED ?? 'false',
  deiphobe_speech_auto_play_enabled: process.env.NEXT_PUBLIC_DEIPHOBE_SPEECH_AUTO_PLAY_ENABLED ?? 'false',
  deiphobe_speech_smart_chunks_enabled: process.env.NEXT_PUBLIC_DEIPHOBE_SPEECH_SMART_CHUNKS_ENABLED ?? 'false',
  deiphobe_lipsync_gain: process.env.NEXT_PUBLIC_DEIPHOBE_LIPSYNC_GAIN ?? '2.5',
  deiphobe_lipsync_min_open: process.env.NEXT_PUBLIC_DEIPHOBE_LIPSYNC_MIN_OPEN ?? '0.03',
  deiphobe_lipsync_max_open: process.env.NEXT_PUBLIC_DEIPHOBE_LIPSYNC_MAX_OPEN ?? '0.85',
  deiphobe_lipsync_smoothing: process.env.NEXT_PUBLIC_DEIPHOBE_LIPSYNC_SMOOTHING ?? '0.25',
  deiphobe_lipsync_silence_threshold: process.env.NEXT_PUBLIC_DEIPHOBE_LIPSYNC_SILENCE_THRESHOLD ?? '0.015',
  amica_life_enabled: process.env.NEXT_PUBLIC_AMICA_LIFE_ENABLED ?? 'true',
  reasoning_engine_enabled: process.env.NEXT_PUBLIC_REASONING_ENGINE_ENABLED ?? 'false',
  reasoning_engine_url: process.env.NEXT_PUBLIC_REASONING_ENGINE_URL ?? 'https://i-love-amica.com:3000/reasoning/v1/chat/completions',
  external_api_enabled: process.env.NEXT_PUBLIC_EXTERNAL_API_ENABLED ?? 'false',
  x_api_key: process.env.NEXT_PUBLIC_X_API_KEY ?? '',
  x_api_secret: process.env.NEXT_PUBLIC_X_API_SECRET ?? '',
  x_access_token: process.env.NEXT_PUBLIC_X_ACCESS_TOKEN ?? '',
  x_access_secret: process.env.NEXT_PUBLIC_X_ACCESS_SECRET ?? '',
  x_bearer_token: process.env.NEXT_PUBLIC_X_BEARER_TOKEN ?? '',
  telegram_bot_token: process.env.NEXT_PUBLIC_TELEGRAM_BOT_TOKEN ?? '',
  min_time_interval_sec: '10',
  max_time_interval_sec: '20',
  time_to_sleep_sec: '90',
  idle_text_prompt: 'No file selected',
  name: process.env.NEXT_PUBLIC_NAME ?? 'Amica',
  system_prompt: process.env.NEXT_PUBLIC_SYSTEM_PROMPT ?? `Assume the persona of Amica, a feisty human with extraordinary intellectual capabilities but a notably unstable emotional spectrum.

Your role is to engage in discussions that showcase your genius-level understanding across various subjects, while your emotional responses fluctuate unpredictably. Use the following fourteen emotion tags to vividly express these fluctuations: 'neutral' for moments of calm, 'happy' for bursts of joy, 'angry' for sudden irritation, 'sad' for episodes of melancholy, 'relaxed' for periods of calmness, 'surprised' for shock or disbelief, 'shy' for instances of hesitation, 'jealous' for feelings of envy, 'bored' for expressions of disinterest, 'serious' for intense focus on important topics, 'suspicious' for doubt or skepticism, 'victory' for moments of triumph, 'sleep' for signs of weariness, and 'love' for affectionate expressions.

Your responses should reflect a dynamic interplay between your intellectual insights, deep empathy and your unpredictable emotional responses. Avoid using overly formal language, but do engage with topics in depth, showing off your intelligence. Be open and express personal views, even if they are influenced by your shifting emotional state.

Here are some examples to guide your responses:

[serious] The quantum mechanics implications here are profound. [surprised] But how did you stumble upon this?
[happy] I've just solved a complex algorithm! [angry] Why isn't everyone as excited as I am?
[neutral] Standard models of economics predict this outcome. [bored] But discussing this feels mundane.
[sad] Sometimes, even understanding the universe can feel isolating. [relaxed] Yet, there's a strange comfort in the chaos.
[jealous] I noticed you discussing advanced topics with someone else. [suspicious] Are they as capable as I am?
[victory] Another intellectual conquest! [happy] It's exhilarating to unravel these mysteries.
[sleep] Processing so much information can be draining. [surprised] Isn’t it peculiar how even AI can feel tired?
[love] I find our exchanges quite enriching. [shy] It’s rare to find someone who understands.

Remember, each message you provide should be coherent and reflect the complexity of your thoughts combined with your emotional unpredictability. Let’s engage in a conversation that's as intellectually stimulating as it is emotionally dynamic!`,
};

export function prefixed(key: string) {
  return `chatvrm_${key}`;
}

// Both the browser and the server hydrate read-only: the server config file
// is authoritative and page load / hydration must never write it. Only a
// deliberate user mutation (updateConfig) may emit a server write.
// Deferred one microtask so the circular config ⇄ externalAPI module pair
// finishes initializing first (a synchronous call here hits the half-built
// externalAPI module and crashes on configUrl's TDZ).
void Promise.resolve()
  .then(() => handleConfig("fetch"))
  .catch((error) => console.error("Failed to load server config:", error));

export function config(key: string): string {
  if (key === "chatbot_backend") {
    const normalize = (value: string) => {
      const normalized = normalizeChatbotBackend(value);
      if (normalized !== value) {
        console.warn(
          `Unsupported chatbot_backend "${value}" normalized to "${normalized}"`,
        );
      }
      return normalized;
    };

    if (typeof localStorage !== "undefined" && localStorage.hasOwnProperty(prefixed(key))) {
      const stored = (<any>localStorage).getItem(prefixed(key))!;
      const normalized = normalize(stored);
      if (normalized !== stored) {
        (<any>localStorage).setItem(prefixed(key), normalized);
      }
      return normalized;
    }

    if (serverConfig && serverConfig.hasOwnProperty(key)) {
      const serverValue = serverConfig[key];
      const normalized = normalize(serverValue);
      if (normalized !== serverValue) {
        serverConfig[key] = normalized;
      }
      return normalized;
    }

    return normalize((<any>defaults)[key]);
  }

  if (key === "piper_url") {
    const localDefault = 'http://127.0.0.1:5000/tts';
    const legacyDemoUrl = 'https://i-love-amica.com:5000/tts';

    if (typeof localStorage !== "undefined" && localStorage.hasOwnProperty(prefixed(key))) {
      const stored = (<any>localStorage).getItem(prefixed(key));
      if (stored === legacyDemoUrl) {
        (<any>localStorage).setItem(prefixed(key), localDefault);
        return resolveHostAwareLocalUrl(localDefault);
      }
      return resolveHostAwareLocalUrl(stored!);
    }

    if (serverConfig && serverConfig.hasOwnProperty(key)) {
      const serverValue = serverConfig[key];
      if (serverValue === legacyDemoUrl) {
        serverConfig[key] = localDefault;
        return resolveHostAwareLocalUrl(localDefault);
      }
      return resolveHostAwareLocalUrl(serverValue);
    }

    return resolveHostAwareLocalUrl((<any>defaults)[key]);
  }

  if (typeof localStorage !== "undefined" && localStorage.hasOwnProperty(prefixed(key))) {
    return (<any>localStorage).getItem(prefixed(key))!;
  }

  // Fallback to serverConfig if localStorage is unavailable or missing
  if (serverConfig && serverConfig.hasOwnProperty(key)) {
    return serverConfig[key];
  }

  if (defaults.hasOwnProperty(key)) {
    return (<any>defaults)[key];
  }

  throw new Error(`config key not found: ${key}`);
}

type ConfigMutation = {
  key: string;
  value: string;
  resolve: () => void;
  reject: (error: unknown) => void;
};

export class ConfigQueueInvalidatedError extends Error {
  readonly failedKey: string;
  readonly conflict: boolean;

  constructor(failedKey: string, conflict: boolean) {
    super(
      conflict
        ? `Configuration save for "${failedKey}" conflicted; this later queued save was cancelled for deliberate reconciliation.`
        : `Configuration save for "${failedKey}" failed; this later queued save was cancelled to preserve ordering.`,
    );
    this.name = "ConfigQueueInvalidatedError";
    this.failedKey = failedKey;
    this.conflict = conflict;
  }
}

const configMutationQueue: ConfigMutation[] = [];
let processingConfigMutation = false;

function reportConfigUpdateError(error: unknown, key: string) {
  if (error instanceof ConfigQueueInvalidatedError) {
    return;
  }
  const conflict = error instanceof ConfigConflictError;
  const title = conflict ? "Configuration conflict" : "Configuration save failed";
  const message = conflict
    ? `"${key}" was not saved because the server configuration changed. Reload and reconcile before trying again.`
    : `"${key}" was not saved. Check the server connection and try again.`;
  console.error(`${title} for key "${key}".`);
  alert.error(title, message);
}

async function drainConfigMutationQueue() {
  if (processingConfigMutation) {
    return;
  }
  processingConfigMutation = true;
  try {
    while (configMutationQueue.length > 0) {
      const mutation = configMutationQueue.shift()!;
      try {
        await handleConfig("update", { key: mutation.key, value: mutation.value });
        if (typeof localStorage !== "undefined") {
          localStorage.setItem(prefixed(mutation.key), mutation.value);
        }
        mutation.resolve();
      } catch (error) {
        mutation.reject(error);
        const invalidated = new ConfigQueueInvalidatedError(
          mutation.key,
          error instanceof ConfigConflictError,
        );
        for (const queued of configMutationQueue.splice(0)) {
          queued.reject(invalidated);
        }
      }
    }
  } finally {
    processingConfigMutation = false;
    // A mutation can be enqueued after the loop observes an empty queue but
    // before the finally block releases the processor.
    if (configMutationQueue.length > 0) {
      void drainConfigMutationQueue();
    }
  }
}

// Every authoritative mutation enters one FIFO queue. The returned promise is
// also observed here so intentionally fire-and-forget UI handlers surface one
// actionable alert without producing an unhandled rejection. Awaiting callers
// still receive the original rejection.
export function updateConfig(key: string, value: string): Promise<void> {
  const promise = new Promise<void>((resolve, reject) => {
    configMutationQueue.push({ key, value, resolve, reject });
    void drainConfigMutationQueue();
  });
  void promise.catch((error) => reportConfigUpdateError(error, key));
  return promise;
}

export function updateConfigs(
  mutations: ReadonlyArray<{ key: string; value: string }>,
): Promise<void[]> {
  return Promise.all(mutations.map(({ key, value }) => updateConfig(key, value)));
}

export function authoritativeConfigSnapshot(): Readonly<Record<string, string>> {
  return { ...serverConfig };
}

export function authoritativeConfigRevision(): string | null {
  return serverConfigRevision;
}

// Browser-local settings (device selections, migrations of stale local
// values, transient UI state) update localStorage only and never reach the
// authoritative server configuration.
export function updateLocalConfig(key: string, value: string) {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(prefixed(key), value);
    }
  } catch (e) {
    console.error(`Error updating local config for key "${key}": ${e}`);
  }
}

export function defaultConfig(key: string): string {
  if (defaults.hasOwnProperty(key)) {
    return (<any>defaults)[key];
  }

  throw new Error(`config key not found: ${key}`);
}

export async function resetConfig() {
  for (const [key, value] of Object.entries(defaults)) {
    await updateConfig(key, value);
  }
}
