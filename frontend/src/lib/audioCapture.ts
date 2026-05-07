/**
 * 16kHz mono Int16 PCM audio capture.
 *
 * Per the STT 移植指南: AudioContext.sampleRate=16000, single channel,
 * ScriptProcessorNode buffer=4096, Float32 → Int16 with the standard
 * `s < 0 ? s * 0x8000 : s * 0x7FFF` mapping. Anything else garbles ASR.
 */

export type PcmSink = (frame: ArrayBuffer) => void;

export interface AudioCaptureHandle {
  stop: () => Promise<void>;
}

const TARGET_SAMPLE_RATE = 16000;
const FRAME_SIZE = 4096;

function floatTo16BitPCM(input: Float32Array): ArrayBuffer {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    output[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return output.buffer;
}

/**
 * Resample a mono Float32 frame from `sourceRate` to 16000 Hz with simple
 * linear interpolation. Precise enough for ASR; cheap on CPU.
 */
function resampleMono(input: Float32Array, sourceRate: number): Float32Array {
  if (sourceRate === TARGET_SAMPLE_RATE) return input;
  const ratio = sourceRate / TARGET_SAMPLE_RATE;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcIdx = i * ratio;
    const lo = Math.floor(srcIdx);
    const hi = Math.min(lo + 1, input.length - 1);
    const t = srcIdx - lo;
    out[i] = input[lo] * (1 - t) + input[hi] * t;
  }
  return out;
}

/**
 * Wrap getUserMedia errors so the calling UI can show a precise message
 * instead of the generic DOMException name.
 */
export class MicPermissionError extends Error {
  reason: "denied" | "unavailable" | "insecure" | "unsupported" | "other";
  constructor(reason: MicPermissionError["reason"], message: string) {
    super(message);
    this.reason = reason;
  }
}

export async function startAudioCapture(sink: PcmSink): Promise<AudioCaptureHandle> {
  // Browsers gate getUserMedia on a secure context (HTTPS or localhost).
  // Fail fast with a clear message instead of a confusing TypeError.
  if (typeof window !== "undefined" && !window.isSecureContext) {
    throw new MicPermissionError(
      "insecure",
      "页面不在安全上下文中(需要 HTTPS),浏览器禁止访问麦克风。",
    );
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new MicPermissionError(
      "unsupported",
      "当前浏览器不支持 getUserMedia API,请用最新版 Chrome / Edge / Safari。",
    );
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
  } catch (err) {
    const e = err as DOMException;
    if (e.name === "NotAllowedError" || e.name === "PermissionDeniedError") {
      throw new MicPermissionError(
        "denied",
        "麦克风权限被拒绝。点击地址栏左侧锁/相机图标 → 允许麦克风,然后刷新页面。",
      );
    }
    if (e.name === "NotFoundError" || e.name === "DevicesNotFoundError") {
      throw new MicPermissionError(
        "unavailable",
        "未检测到可用麦克风。请插上耳麦/麦克风后再试。",
      );
    }
    if (e.name === "NotReadableError" || e.name === "TrackStartError") {
      throw new MicPermissionError(
        "unavailable",
        "麦克风被其他应用占用(如腾讯会议、Zoom),请先关闭它们。",
      );
    }
    throw new MicPermissionError(
      "other",
      `麦克风启动失败:${e.message || e.name || "未知错误"}`,
    );
  }

  // Try to get the AudioContext at exactly 16kHz; fall back and resample if the
  // browser refuses (Safari historically pinned to hardware rate).
  let audioCtx: AudioContext;
  try {
    audioCtx = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
  } catch {
    audioCtx = new AudioContext();
  }
  const sourceRate = audioCtx.sampleRate;
  const needResample = sourceRate !== TARGET_SAMPLE_RATE;

  const source = audioCtx.createMediaStreamSource(stream);
  const processor = audioCtx.createScriptProcessor(FRAME_SIZE, 1, 1);

  processor.onaudioprocess = (e) => {
    const ch = e.inputBuffer.getChannelData(0);
    const mono16k = needResample ? resampleMono(ch, sourceRate) : ch;
    sink(floatTo16BitPCM(mono16k));
  };

  source.connect(processor);
  // ScriptProcessorNode requires a destination connection to run.
  processor.connect(audioCtx.destination);

  return {
    stop: async () => {
      try { processor.disconnect(); } catch {}
      try { source.disconnect(); } catch {}
      try { await audioCtx.close(); } catch {}
      stream.getTracks().forEach((t) => t.stop());
    },
  };
}
