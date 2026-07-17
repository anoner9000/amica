import { LipSyncAnalyzeResult } from "./lipSyncAnalyzeResult";
import { resolveVoiceVolume } from "@/utils/voiceVolume";
import { config } from "@/utils/config";

const TIME_DOMAIN_DATA_LENGTH = 2048;

function readLipSyncParam(key: string, fallback: number): number {
  const v = parseFloat(config(key as Parameters<typeof config>[0]) ?? String(fallback));
  return isFinite(v) ? v : fallback;
}

export class LipSync {
  public readonly audio: AudioContext;
  public readonly analyser: AnalyserNode;
  public readonly timeDomainData: Float32Array;
  private _currentSource: AudioBufferSourceNode | null = null;
  private _prevSmoothed: number = 0;

  public constructor(audio: AudioContext) {
    this.audio = audio;

    this.analyser = audio.createAnalyser();
    this.timeDomainData = new Float32Array(TIME_DOMAIN_DATA_LENGTH);
  }

  public update(): LipSyncAnalyzeResult {
    this.analyser.getFloatTimeDomainData(this.timeDomainData);

    let peak = 0.0;
    for (let i = 0; i < TIME_DOMAIN_DATA_LENGTH; i++) {
      peak = Math.max(peak, Math.abs(this.timeDomainData[i]));
    }

    // Sigmoid shaping (original curve)
    let volume = 1 / (1 + Math.exp(-45 * peak + 5));

    const gain = readLipSyncParam("deiphobe_lipsync_gain", 2.5);
    const silenceThreshold = readLipSyncParam("deiphobe_lipsync_silence_threshold", 0.015);
    const smoothing = readLipSyncParam("deiphobe_lipsync_smoothing", 0.25);
    const minOpen = readLipSyncParam("deiphobe_lipsync_min_open", 0.03);
    const maxOpen = readLipSyncParam("deiphobe_lipsync_max_open", 0.85);

    volume *= gain;

    if (peak < silenceThreshold) {
      volume = 0;
      this._prevSmoothed = 0;
    } else {
      volume = smoothing * this._prevSmoothed + (1 - smoothing) * volume;
      this._prevSmoothed = volume;
      volume = Math.max(minOpen, Math.min(maxOpen, volume));
    }

    return { volume };
  }

  public async playFromArrayBuffer(buffer: ArrayBuffer, onEnded?: () => void, volume = 1) {
    const audioBuffer = await this.audio.decodeAudioData(buffer);

    const bufferSource = this.audio.createBufferSource();
    const gain = this.audio.createGain();
    bufferSource.buffer = audioBuffer;
    gain.gain.value = resolveVoiceVolume(volume);

    bufferSource.connect(gain);
    gain.connect(this.audio.destination);
    gain.connect(this.analyser);

    this._currentSource = bufferSource;
    bufferSource.addEventListener("ended", () => {
      if (this._currentSource === bufferSource) this._currentSource = null;
    });

    bufferSource.start();
    if (onEnded) {
      bufferSource.addEventListener("ended", onEnded);
    }
  }

  public stopCurrent(): void {
    if (this._currentSource) {
      try { this._currentSource.stop(); } catch (_) {}
      this._currentSource = null;
    }
  }

  public reset(): void {
    this.stopCurrent();
    this.timeDomainData.fill(0);
    this._prevSmoothed = 0;
  }

  public async playFromURL(url: string, onEnded?: () => void) {
    const res = await fetch(url);
    const buffer = await res.arrayBuffer();
    this.playFromArrayBuffer(buffer, onEnded);
  }
}
