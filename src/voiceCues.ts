// Synthesized audio cues for voice dictation. Kept asset-free: short Gentle
// sine chirps generated with WebAudio, played through a shared lazily created
// AudioContext. Start = rising two-tone, stop = falling two-tone, error =
// low double-blip, transcript sealed = soft high tick. Levels are low so cues
// read as interface sounds, not notifications.

let sharedContext: AudioContext | null = null;

// The renderer cannot always create a running AudioContext on demand (autoplay
// policy mutes new contexts outside a user gesture — exactly when the start
// cue fires after the mic click). Caller-provided running contexts are
// preferred; a detached one is the fallback.
export function setVoiceCueContext(context: AudioContext | null): void {
  sharedContext = context;
}

async function context(): Promise<AudioContext | null> {
  if (typeof window === "undefined" || typeof window.AudioContext !== "function") return null;
  if (!sharedContext) {
    try {
      sharedContext = new AudioContext();
    } catch {
      return null;
    }
  }
  if (sharedContext.state !== "running") {
    try {
      await sharedContext.resume();
    } catch {
      return null;
    }
    if ((sharedContext.state as string) !== "running") return null;
  }
  return sharedContext;
}

type Cue = {
  tone: (time: number) => { frequency: number; duration: number; gain: number; type?: OscillatorType };
  tones: number;
  interval: number;
};

const CUES: Record<"start" | "stop" | "error" | "sealed", Cue> = {
  start: {
    tones: 2,
    interval: 0.09,
    tone: (time) => ({ frequency: time < 0.09 ? 660 : 880, duration: 0.09, gain: 0.05 }),
  },
  stop: {
    tones: 2,
    interval: 0.09,
    tone: (time) => ({ frequency: time < 0.09 ? 880 : 620, duration: 0.09, gain: 0.05 }),
  },
  error: {
    tones: 2,
    interval: 0.14,
    tone: () => ({ frequency: 300, duration: 0.12, gain: 0.07, type: "triangle" }),
  },
  sealed: {
    tones: 1,
    interval: 0,
    tone: () => ({ frequency: 1180, duration: 0.06, gain: 0.035 }),
  },
};

export function playVoiceCue(name: keyof typeof CUES): void {
  void context().then((audio) => {
    if (!audio) return;
  const cue = CUES[name];
  const now = audio.currentTime;
  for (let index = 0; index < cue.tones; index++) {
    const at = now + index * cue.interval;
    const spec = cue.tone(at - now);
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = spec.type ?? "sine";
    oscillator.frequency.value = spec.frequency;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(spec.gain, at + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + spec.duration);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(at);
    oscillator.stop(at + spec.duration + 0.02);
    }
  });
}

export function disposeVoiceCues(): void {
  if (sharedContext) {
    void sharedContext.close().catch(() => undefined);
    sharedContext = null;
  }
}
