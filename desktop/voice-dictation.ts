// Voice dictation backend wiring: microphone permission + STT credentials.
//
// The renderer captures mic audio with getUserMedia and streams it over the
// authenticated backend WebSocket proxy. The Smallest.ai key stays server-side;
// this module only hands the renderer the base URL + API key it is already
// entitled to (same credential the CLI stores in ~/.maximo.json).

import { BrowserWindow, systemPreferences } from "electron";
import { readGlobalConfig } from "./auth-service.js";
import type { VoiceDictationCredentials } from "./types.js";

const MAXIMO_WS_BASE = "wss://api.maximoai.co";
const MYTABULON_WS_BASE = "wss://api.mytabulon.com";

export async function readVoiceDictationCredentials(): Promise<VoiceDictationCredentials> {
  const config = await readGlobalConfig();
  const apiKey = typeof config.maximoApiKey === "string" ? config.maximoApiKey : "";
  const baseUrl = typeof config.openAIBaseUrl === "string" ? config.openAIBaseUrl : "";
  if (!apiKey) return { available: false };
  const normalized = baseUrl.replace(/\/+$/, "").replace(/\/v1$/i, "");
  const wsBase = normalized.includes("api.mytabulon.com")
    ? MYTABULON_WS_BASE
    : normalized.includes("api.maximoai.co")
      ? MAXIMO_WS_BASE
      : "";
  if (!wsBase) return { available: false };
  return { available: true, wsUrl: `${wsBase}/ws/speech-to-text`, apiKey };
}

export async function requestMicrophonePermission(): Promise<"granted" | "denied" | "unknown"> {
  if (process.platform !== "darwin") return "granted";
  try {
    const status = systemPreferences.getMediaAccessStatus("microphone");
    if (status === "granted") return "granted";
    if (status === "denied" || status === "restricted") return "denied";
    const granted = await systemPreferences.askForMediaAccess("microphone");
    return granted ? "granted" : "denied";
  } catch {
    return "unknown";
  }
}
