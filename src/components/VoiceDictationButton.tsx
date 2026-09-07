// Mic button for the composer input. Starts a streaming STT session against
// the authenticated backend proxy; the interim transcript streams directly
// into the composer. States: mic at rest → stop square while dialing or
// listening (with pulsing ring + live level bars) → spinner only while the
// final transcript flushes.

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, Loader2, Square } from "lucide-react";
import {
  isDictationSupported,
  loadDictationCredentials,
  startDictation,
  stopDictation,
  onDictationAudioContext,
  type DictationState,
} from "../voiceDictation.js";
import { playVoiceCue, setVoiceCueContext } from "../voiceCues.js";

type Props = {
  disabled?: boolean;
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (message: string) => void;
};

type Level = number;

const LEVEL_BARS = 4;

export function VoiceDictationButton({ disabled, onInterim, onFinal, onError }: Props) {
  const [state, setState] = useState<DictationState>("idle");
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [levels, setLevels] = useState<Level[]>(() => Array.from({ length: LEVEL_BARS }, () => 0.15));
  const stateRef = useRef<DictationState>("idle");
  const sessionRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!isDictationSupported()) {
        if (!cancelled) setConfigured(false);
        return;
      }
      const ok = await loadDictationCredentials();
      if (!cancelled) setConfigured(ok);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => () => {
    if (sessionRef.current) void stopDictation();
    setVoiceCueContext(null);
  }, []);

  // Route cues through the dictation session's AudioContext: it was created
  // inside the click gesture, so it is guaranteed running — the start cue
  // cannot be muted by autoplay policy.
  useEffect(() => onDictationAudioContext((context) => setVoiceCueContext(context)), []);

  const applyState = useCallback((next: DictationState, previous: DictationState) => {
    // Audio cues mark the user-perceivable moments: capture begins, capture
    // ends (manual or auto), and the transcript settles into the composer.
    if (next === "listening" && previous !== "listening") playVoiceCue("start");
    if (next === "processing") playVoiceCue("stop");
    stateRef.current = next;
    // The session can end without a manual tap (silence auto-stop, transcript
    // sealed, socket close). Every return to idle must re-open the mic button
    // or the next tap lands on the "already in a session" guard and is
    // silently swallowed.
    if (next === "idle") sessionRef.current = false;
    setState(next);
  }, []);

  const handleToggle = useCallback(async () => {
    if (stateRef.current === "listening" || (stateRef.current === "connecting" && sessionRef.current)) {
      // Stop square ends + flushes; while dialing it cancels the attempt.
      sessionRef.current = false;
      await stopDictation();
      applyState("idle", stateRef.current);
      return;
    }
    if (sessionRef.current) return;
    sessionRef.current = true;
    setLevels(Array.from({ length: LEVEL_BARS }, () => 0.15));
    const started = await startDictation({
      onStateChange: (next) => applyState(next, stateRef.current),
      onInterim: (text) => onInterim(text),
      onFinal: (text) => {
        if (text.trim()) {
          onFinal(text);
          playVoiceCue("sealed");
        }
        onInterim("");
      },
      onLevel: (level) => {
        setLevels((current) => [...current.slice(1), level]);
      },
      onError: (message, fatal) => {
        if (fatal) playVoiceCue("error");
        if (sessionRef.current || fatal) onError(message);
        if (fatal) {
          sessionRef.current = false;
          applyState("idle", stateRef.current);
          onInterim("");
        }
      },
    });
    if (!started) sessionRef.current = false;
  }, [applyState, onError, onFinal, onInterim]);

  const active = state === "connecting" || state === "listening";
  const disabledFull = Boolean(disabled) || state === "processing" || configured === false;
  if (configured === false) return null;
  return (
    <button
      type="button"
      className={[
        "voice-mic-button",
        active ? "recording" : "",
        state === "listening" ? "listening" : "",
      ].filter(Boolean).join(" ")}
      onClick={() => void handleToggle()}
      disabled={disabledFull}
      title={active ? "Stop dictation" : "Voice input"}
      aria-label={active ? "Stop voice dictation" : "Start voice dictation"}
      aria-pressed={active}
    >
      {state === "processing" ? (
        <Loader2 size={15} className="voice-mic-spinner" />
      ) : active ? (
        <Square size={10} fill="currentColor" strokeWidth={0} />
      ) : (
        <Mic size={15} />
      )}
      {state === "listening" && (
        <span className="voice-mic-levels" aria-hidden="true">
          {levels.map((level, index) => (
            <i key={index} style={{ height: `${Math.round(20 + Math.min(1, level) * 80)}%` }} />
          ))}
        </span>
      )}
    </button>
  );
}
