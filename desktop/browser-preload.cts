import { ipcRenderer } from "electron";

const LOOKUP_CHANNEL = "maximo-browser:credential-lookup";
const SUBMIT_CHANNEL = "maximo-browser:credential-submitted";
const USERNAME_CHANNEL = "maximo-browser:username-observed";
const CHANGED_CHANNEL = "maximo-browser:credentials-changed";

interface AutofillCredential {
  username: string;
  password: string;
}

let credential: AutofillCredential | null = null;
let lookupInFlight: Promise<void> | null = null;
let scanTimer: ReturnType<typeof setTimeout> | null = null;
let lastSubmissionFingerprint = "";
let lastSubmissionAt = 0;
const filledPasswordInputs = new WeakSet<HTMLInputElement>();

function supportedOrigin(): string | null {
  try {
    const url = new URL(window.location.href);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
    if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function inputElements(root: ParentNode): HTMLInputElement[] {
  try {
    return [...root.querySelectorAll<HTMLInputElement>("input")];
  } catch {
    return [];
  }
}

function isUsable(input: HTMLInputElement): boolean {
  return !input.disabled && !input.readOnly && input.type !== "hidden" && input.getClientRects().length > 0;
}

function autocompleteTokens(input: HTMLInputElement): string[] {
  return input.autocomplete.toLocaleLowerCase("en-US").split(/\s+/).filter(Boolean);
}

function isFillablePassword(input: HTMLInputElement): boolean {
  const tokens = autocompleteTokens(input);
  return input.type === "password" && isUsable(input) && !tokens.includes("new-password") && !tokens.includes("one-time-code");
}

function isCapturablePassword(input: HTMLInputElement): boolean {
  const tokens = autocompleteTokens(input);
  return input.type === "password" && !input.disabled && !tokens.includes("one-time-code") && Boolean(input.value);
}

function usernameScore(input: HTMLInputElement, password: HTMLInputElement): number {
  if (!isUsable(input) || (input.type !== "text" && input.type !== "email" && input.type !== "tel" && input.type !== "")) return Number.NEGATIVE_INFINITY;
  const tokens = autocompleteTokens(input);
  const descriptor = `${input.name} ${input.id} ${input.getAttribute("aria-label") ?? ""} ${input.placeholder}`.toLocaleLowerCase("en-US");
  let score = 0;
  if (tokens.includes("username")) score += 1_000;
  if (input.type === "email") score += 500;
  if (/user|email|login|account|identifier/.test(descriptor)) score += 250;
  if (input.form && input.form === password.form) score += 100;
  try {
    if (input.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_FOLLOWING) score += 50;
  } catch { /* Detached inputs cannot be ordered. */ }
  return score;
}

function usernameInputFor(password: HTMLInputElement, inputs: HTMLInputElement[]): HTMLInputElement | null {
  return inputs
    .map((input) => ({ input, score: usernameScore(input, password) }))
    .filter(({ score }) => Number.isFinite(score))
    .sort((left, right) => right.score - left.score)[0]?.input ?? null;
}

function setFrameworkFriendlyValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (setter) setter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
}

function fillVisibleLogin(): void {
  if (!credential || !supportedOrigin()) return;
  const inputs = inputElements(document);
  const password = inputs.find((input) => isFillablePassword(input) && !filledPasswordInputs.has(input));
  if (!password) return;
  const username = usernameInputFor(password, inputs);
  if (username?.value && username.value.trim().toLocaleLowerCase("en-US") !== credential.username.toLocaleLowerCase("en-US")) return;
  if (username && !username.value) setFrameworkFriendlyValue(username, credential.username);
  if (!password.value) setFrameworkFriendlyValue(password, credential.password);
  filledPasswordInputs.add(password);
}

function scheduleScan(): void {
  if (scanTimer) return;
  scanTimer = setTimeout(() => {
    scanTimer = null;
    fillVisibleLogin();
  }, 80);
}

function lookupCredential(force = false): Promise<void> {
  const origin = supportedOrigin();
  if (!origin || lookupInFlight) return lookupInFlight ?? Promise.resolve();
  if (credential && !force) {
    scheduleScan();
    return Promise.resolve();
  }
  lookupInFlight = ipcRenderer.invoke(LOOKUP_CHANNEL, { origin }).then((value: unknown) => {
    const candidate = value && typeof value === "object" ? value as Partial<AutofillCredential> : null;
    credential = candidate && typeof candidate.username === "string" && typeof candidate.password === "string"
      ? { username: candidate.username.slice(0, 512), password: candidate.password.slice(0, 16_384) }
      : null;
    scheduleScan();
  }).catch(() => {
    credential = null;
  }).finally(() => {
    lookupInFlight = null;
  });
  return lookupInFlight;
}

function captureCredential(root: ParentNode): void {
  const origin = supportedOrigin();
  if (!origin) return;
  const inputs = inputElements(root);
  const passwordInputs = inputs.filter(isCapturablePassword);
  if (passwordInputs.length === 0) {
    const usernameOnly = inputs
      .filter((input) => usernameScore(input, input) > 0 && Boolean(input.value.trim()))
      .sort((left, right) => usernameScore(right, right) - usernameScore(left, left))[0];
    if (usernameOnly) ipcRenderer.send(USERNAME_CHANNEL, { origin, username: usernameOnly.value.trim().slice(0, 512) });
    return;
  }

  const currentPassword = passwordInputs.find((input) => autocompleteTokens(input).includes("current-password"));
  const newPasswords = passwordInputs.filter((input) => autocompleteTokens(input).includes("new-password"));
  const matchingNewPassword = newPasswords.length >= 2 && newPasswords.every((input) => input.value === newPasswords[0]!.value)
    ? newPasswords[0]
    : newPasswords.length === 1 ? newPasswords[0] : null;
  const password = currentPassword ?? matchingNewPassword ?? passwordInputs[0];
  if (!password || !password.value || password.value.length > 16_384) return;
  const usernameInput = usernameInputFor(password, inputs);
  const username = usernameInput?.value.trim().slice(0, 512) ?? "";
  const fingerprint = `${origin}\n${username}\n${password.value}`;
  const now = Date.now();
  if (fingerprint === lastSubmissionFingerprint && now - lastSubmissionAt < 2_000) return;
  lastSubmissionFingerprint = fingerprint;
  lastSubmissionAt = now;
  ipcRenderer.send(SUBMIT_CHANNEL, {
    origin,
    username,
    password: password.value,
  });
}

function formRoot(target: EventTarget | null): ParentNode {
  if (target instanceof HTMLFormElement) return target;
  if (target instanceof Element) return target.closest("form") ?? document;
  return document;
}

if (window.top === window) {
  const start = () => {
    void lookupCredential();
    const observer = new MutationObserver(scheduleScan);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener("submit", (event) => captureCredential(formRoot(event.target)), true);
    document.addEventListener("click", (event) => {
      const element = event.target instanceof Element ? event.target.closest("button, input") : null;
      if (!(element instanceof HTMLButtonElement || element instanceof HTMLInputElement)) return;
      const type = element instanceof HTMLButtonElement ? element.type : element.type.toLocaleLowerCase("en-US");
      if (type !== "submit" && type !== "image") return;
      setTimeout(() => captureCredential(element.form ?? document), 0);
    }, true);
  };
  if (document.readyState === "loading") window.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
  ipcRenderer.on(CHANGED_CHANNEL, () => {
    credential = null;
    void lookupCredential(true);
  });
}
