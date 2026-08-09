export interface PersistentBrowserSession {
  flushStorageData: () => void;
  cookies: {
    flushStore: () => Promise<void>;
  };
}

const BROWSER_SESSION_FLUSH_TIMEOUT_MS = 2_000;

/** Ensure recent browser logins and site storage reach disk before app exit. */
export async function flushPersistentBrowserSession(browserSession: PersistentBrowserSession): Promise<void> {
  browserSession.flushStorageData();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      browserSession.cookies.flushStore(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("Timed out while saving the browser session.")), BROWSER_SESSION_FLUSH_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
