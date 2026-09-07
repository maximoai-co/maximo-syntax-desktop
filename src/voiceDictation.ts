// Streaming speech-to-text for composer dictation (Smallest.ai Pulse via the
// authenticated Maximo AI / MyTabulon backend WebSocket proxy). Captures the
// microphone with getUserMedia, downsamples to 16 kHz linear16 PCM, and streams
// binary frames; transcript events arrive as JSON messages. Auth rides on the
// `token` query parameter because browsers cannot set headers on WebSockets.
// Dictation auto-stops after sustained silence once speech has been heard, and
// also if the user never speaks.

export type DictationState = "idle" | "connecting" | "listening" | "processing";

export type DictationCallbacks = {
  onInterim?: (text: string) => void;
  onFinal?: (text: string) => void;
  onStateChange?: (state: DictationState) => void;
  onLevel?: (level: number) => void;
  onError?: (message: string, fatal?: boolean) => void;
};

const TARGET_SAMPLE_RATE = 16_000;
const FLUSH_INTERVAL_MS = 200;
const FINALIZE_TIMEOUT_MS = 10_000;
const CONNECT_TIMEOUT_MS = 10_000;
const NO_AUDIO_WATCHDOG_MS = 3_500;
const HARD_TIME_LIMIT_MS = 35_000;
const SILENCE_AUTO_STOP_MS = 1_800;
const NO_SPEECH_AUTO_STOP_MS = 10_000;
const SPEECH_LEVEL_THRESHOLD = 0.33;
const SILENCE_LEVEL_THRESHOLD = 0.2;
const MAX_KEYWORDS_LENGTH = 2_000;

type Session = {
  ws: WebSocket;
  stream: MediaStream;
  source: MediaStreamAudioSourceNode;
  processor: ScriptProcessorNode;
  context: AudioContext;
  flushTimer: number | null;
};

let session: Session | null = null;
let credentials: { wsUrl: string; apiKey: string } | null = null;
let tailPcm: Int16Array | null = null;
let audioContextListener: ((context: AudioContext | null) => void) | null = null;
// Bumped on every start and by stopDictation: any start still awaiting mic
// permission/capture detects the mismatch and aborts instead of registering a
// session nobody asked for (its watchdog could also tear down a newer one).
let startAttempt = 0;

// Lets the cue player borrow the session's (user-gesture-created, guaranteed
// running) AudioContext so start/stop/sealed sounds can't be muted by the
// autoplay policy.
export function onDictationAudioContext(
  listener: (context: AudioContext | null) => void
): () => void {
  audioContextListener = listener;
  return () => {
    if (audioContextListener === listener) audioContextListener = null;
  };
}

export function isDictationSupported(): boolean {
  return Boolean(
    navigator.mediaDevices &&
      typeof navigator.mediaDevices.getUserMedia === "function" &&
      typeof WebSocket === "function" &&
      typeof window.AudioContext === "function"
  );
}

export async function loadDictationCredentials(): Promise<boolean> {
  const value = await window.maximoDesktop.voiceCredentials();
  if (!value.available || !value.wsUrl || !value.apiKey) {
    credentials = null;
    return false;
  }
  credentials = { wsUrl: value.wsUrl, apiKey: value.apiKey };
  return true;
}

export function isDictationConfigured(): boolean {
  return credentials !== null;
}

function downsample(input: Float32Array, fromRate: number): Int16Array {
  if (fromRate === TARGET_SAMPLE_RATE) return floatToInt16(input);
  const ratio = fromRate / TARGET_SAMPLE_RATE;
  const length = Math.floor(input.length / ratio);
  const output = new Int16Array(length);
  for (let i = 0; i < length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(Math.floor((i + 1) * ratio), input.length);
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j] ?? 0;
    output[i] = floatToInt16(Float32Array.of(sum / Math.max(end - start, 1)))[0] ?? 0;
  }
  return output;
}

function floatToInt16(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const sample = Math.max(-1, Math.min(1, input[i] ?? 0));
    output[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return output;
}

export async function startDictation(
  callbacks: DictationCallbacks,
  options?: { keyterms?: string[] }
): Promise<boolean> {
  if (session) return true;
  if (!credentials && !(await loadDictationCredentials())) {
    callbacks.onError?.("Voice input requires a Maximo AI or MyTabulon account.", true);
    return false;
  }
  const { wsUrl, apiKey } = credentials!;
  // The credentials channel may still yield an https:// base from an older
  // main process; WebSockets must use ws/wss or the handshake can stall.
  const wsBase = wsUrl.replace(/^https:/i, "wss:").replace(/^http:/i, "ws:");
  const attempt = ++startAttempt;
  const onState = (state: DictationState) => callbacks.onStateChange?.(state);
  let disposed = false;

  // The stage watchdog covers EVERYTHING before the WS handshake resolves —
  // mic-permission dialogs, getUserMedia, and the connect itself. Without it a
  // hung capture or handshake strands the button in "connecting" silently.
  // The WS-specific timeout below still refines the error once we have a socket.
  const stageTimeout = window.setTimeout(() => {
    if (!disposed) {
      disposed = true;
      onState("idle");
      callbacks.onError?.(
        atCaptureStage
          ? "Microphone didn't respond in time. Check mic permission and input device, then try again."
          : "Voice connection timed out. Check your network and try again.",
        true,
      );
    }
  }, CONNECT_TIMEOUT_MS);

  let stream: MediaStream;
  let atCaptureStage = true;
  try {
    onState("connecting");
    await window.maximoDesktop.requestMicPermission();
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    // A stop/cancel happened while permission or capture was pending.
    if (startAttempt !== attempt) {
      stream.getTracks().forEach((track) => track.stop());
      disposed = true;
      window.clearTimeout(stageTimeout);
      return false;
    }
  } catch {
    disposed = true;
    window.clearTimeout(stageTimeout);
    if (startAttempt === attempt) {
      onState("idle");
      callbacks.onError?.("Microphone access was denied. Allow microphone access to use voice input.", true);
    }
    return false;
  }
  atCaptureStage = false;

  const params = new URLSearchParams({
    language: "en",
    encoding: "linear16",
    sample_rate: String(TARGET_SAMPLE_RATE),
    word_timestamps: "false",
    endpointing: "true",
    eou_timeout_ms: "800",
    format: "true",
    itn_normalize: "true",
    finalize_on_words: "false",
  });
  const keywords = (options?.keyterms ?? [])
    .map((term) => term.trim())
    .filter(Boolean)
    .join(",")
    .slice(0, MAX_KEYWORDS_LENGTH);
  if (keywords) params.set("keywords", keywords);

  let ws: WebSocket;
  try {
    ws = new WebSocket(`${wsBase}?${params.toString()}&token=${encodeURIComponent(apiKey)}`);
  } catch {
    disposed = true;
    window.clearTimeout(stageTimeout);
    stream.getTracks().forEach((track) => track.stop());
    onState("idle");
    callbacks.onError?.("Could not open the voice connection.", true);
    return false;
  }
  ws.binaryType = "arraybuffer";

  const context = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
  audioContextListener?.(context);
  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(4096, 1, 1);
  let pendingPcm: Int16Array | null = null;
  let reportedFatal = false;

  // Register the session before the handshake resolves so a tap during
  // "connecting" can cancel the attempt via stopDictation().
  session = { ws, stream, source, processor, context, flushTimer: null };
  if (startAttempt !== attempt) {
    // Cancelled between the check above and here — clean up this attempt's
    // capture immediately instead of letting it open a rogue session.
    stream.getTracks().forEach((track) => track.stop());
    void context.close().catch(() => undefined);
    return false;
  }

  let opened = false;
  let finalized = false;
  let interim = "";
  let lastInterim = "";
  let startedAtMs = 0;
  let lastVoiceMs = 0;
  let speechSeen = false;
  let sawAudioFrame = false;

  // Fail-safe timers: a server that never completes the handshake would
  // otherwise strand the button in "connecting", and a suspended/muted audio
  // graph would auto-stop never (no frames → no silence detection).
  const connectTimeout = window.setTimeout(() => {
    if (!opened && !disposed) {
      reportedFatal = true;
      callbacks.onError?.("Voice connection timed out. Check your network and try again.", true);
      teardown();
      try { ws.close(); } catch { /* already closed */ }
    }
  }, CONNECT_TIMEOUT_MS);
  const hardLimit = window.setTimeout(() => {
    void stopDictation();
  }, HARD_TIME_LIMIT_MS);

  const teardown = () => {
    disposed = true;
    window.clearTimeout(stageTimeout);
    window.clearTimeout(connectTimeout);
    window.clearTimeout(hardLimit);
    // Only tear down what THIS attempt owns: a stale session's delayed
    // onclose/onerror must never kill a freshly started successor, and it
    // must not flip the button to idle while a new session is live.
    if (session && startAttempt === attempt) {
      if (session.flushTimer !== null) window.clearInterval(session.flushTimer);
      try { session.processor.disconnect(); } catch { /* already detached */ }
      try { session.source.disconnect(); } catch { /* already detached */ }
      void session.context.close().catch(() => undefined);
      session = null;
      audioContextListener?.(null);
      stream.getTracks().forEach((track) => track.stop());
      onState("idle");
    }
  };

  const flush = () => {
    if (!session || session.ws !== ws || !pendingPcm) return;
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(pendingPcm.buffer);
      pendingPcm = null;
      tailPcm = null;
    }
  };

  const finish = () => {
    onState("processing");
    void stopDictation();
  };

  // Handlers attach before the handshake resolves so a rejected connection
  // (bad token, network failure) can never strand the UI in "connecting".
  ws.onerror = () => {
    if (ws.readyState === WebSocket.CONNECTING) {
      reportedFatal = true;
      callbacks.onError?.("Voice connection failed. Check your network and try again.", true);
      teardown();
    }
  };

  ws.onclose = (event) => {
    if (!opened) {
      if (!finalized && !reportedFatal && session?.ws === ws) {
        callbacks.onError?.("Voice connection failed. Check your network and try again.", true);
      }
      teardown();
      return;
    }
    if (!finalized) {
      if (interim.trim()) callbacks.onFinal?.(interim.trim());
      if (event.code !== 1000 && event.code !== 1005 && event.code !== 1006) {
        callbacks.onError?.(`Voice connection closed (${event.code}).`);
      }
    }
    callbacks.onInterim?.("");
    teardown();
  };

  ws.onmessage = (event) => {
    if (typeof event.data !== "string") return;
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(event.data) as Record<string, unknown>;
    } catch {
      return;
    }
    if (message.type === "error" || message.error) {
      const message_ = String(message.message ?? message.error ?? "Transcription failed.");
      callbacks.onError?.(message_, finalized);
      return;
    }
    if (typeof message.transcript !== "string") return;
    const text = message.transcript;
    if (message.is_last === true) {
      finalized = true;
      if (text.trim() && text !== lastInterim) callbacks.onFinal?.(text.trim());
      callbacks.onInterim?.("");
      teardown();
      return;
    }
    if (message.is_final === true) {
      lastInterim = "";
      interim = "";
      callbacks.onInterim?.("");
      callbacks.onFinal?.(text.trim());
    } else {
      interim = text;
      lastInterim = text;
      callbacks.onInterim?.(text);
    }
  };

  ws.onopen = () => {
    // stopDictation() may have cancelled the attempt mid-handshake.
    if (!session || session.ws !== ws) return;
    opened = true;
    startedAtMs = performance.now();
    lastVoiceMs = startedAtMs;
    session.flushTimer = window.setInterval(flush, FLUSH_INTERVAL_MS);
    onState("listening");
    window.setTimeout(() => {
      // If the audio graph produced nothing by now, capture is dead (suspended
      // context, muted device) — fail loudly rather than "listening" forever.
      if (!sawAudioFrame && session?.ws === ws && !finalized) {
        reportedFatal = true;
        callbacks.onError?.("No audio is reaching the microphone. Check input device permissions.", true);
        teardown();
      }
    }, NO_AUDIO_WATCHDOG_MS);

    processor.onaudioprocess = (event) => {
      if (!session || session.ws !== ws) return;
      const input = event.inputBuffer.getChannelData(0);
      let sumSquares = 0;
      for (let i = 0; i < input.length; i++) sumSquares += (input[i] ?? 0) ** 2;
      const rms = Math.sqrt(sumSquares / Math.max(input.length, 1));
      const level = Math.min(1, Math.sqrt(rms * 6));
      sawAudioFrame = true;
      callbacks.onLevel?.(level);

      // Hands-free auto-stop: once the user has spoken, a sustained pause or
      // continued total silence ends the session and flushes the transcript.
      const nowMs = performance.now();
      if (level >= SPEECH_LEVEL_THRESHOLD) {
        speechSeen = true;
        lastVoiceMs = nowMs;
      } else if (
        !speechSeen &&
        nowMs - startedAtMs >= NO_SPEECH_AUTO_STOP_MS
      ) {
        finish();
        return;
      } else if (
        speechSeen &&
        level < SILENCE_LEVEL_THRESHOLD &&
        nowMs - lastVoiceMs >= SILENCE_AUTO_STOP_MS
      ) {
        finish();
        return;
      }

      const pcm = downsample(input, event.inputBuffer.sampleRate);
      pendingPcm = pendingPcm ? concatInt16(pendingPcm, pcm) : pcm;
      tailPcm = pendingPcm;
    };
    source.connect(processor);
    // ScriptProcessor requires a destination to pull; mute its output.
    processor.connect(context.destination);
    // Chrome can deliver the AudioContext suspended (autoplay policy); without
    // resume() zero frames flow and nothing transcribes or auto-stops.
    if (context.state === "suspended") void context.resume().catch(() => undefined);
  };

  return true;
}

function concatInt16(a: Int16Array, b: Int16Array): Int16Array {
  const merged = new Int16Array(a.length + b.length);
  merged.set(a);
  merged.set(b, a.length);
  return merged;
}

export async function stopDictation(): Promise<void> {
  const current = session;
  // Invalidate any start attempt still awaiting permission/capture so it
  // aborts instead of registering a session after this stop.
  startAttempt += 1;
  if (!current) return;
  session = null;
  if (current.ws.readyState === WebSocket.OPEN) {
    // Flush any buffered tail audio before finalizing so the last moments of
    // speech are included in the transcript.
    if (tailPcm && tailPcm.length > 0) {
      try { current.ws.send(tailPcm.buffer); } catch { /* socket closing */ }
      tailPcm = null;
    }
    current.ws.send(JSON.stringify({ type: "close_stream" }));
    window.setTimeout(() => {
      try { current.ws.close(); } catch { /* already closed */ }
    }, FINALIZE_TIMEOUT_MS);
  } else {
    try { current.ws.close(); } catch { /* already closed */ }
  }
  if (current.flushTimer !== null) window.clearInterval(current.flushTimer);
  try { current.processor.disconnect(); } catch { /* already detached */ }
  try { current.source.disconnect(); } catch { /* already detached */ }
  void current.context.close().catch(() => undefined);
  audioContextListener?.(null);
  current.stream.getTracks().forEach((track) => track.stop());
}
