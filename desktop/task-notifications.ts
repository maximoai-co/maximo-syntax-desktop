import type { Thread, ThreadStatus } from "./types.js";

export interface TaskCompletionNotification {
  title: string;
  body: string;
  threadId: string;
}

interface TaskCompletionState {
  selectedThreadId?: string;
  threads: ReadonlyArray<Pick<Thread, "id" | "title" | "status" | "unread">>;
}

function completionBody(status: ThreadStatus): string | null {
  if (status === "complete") return "Finished successfully.";
  if (status === "error") return "Ended with an error.";
  if (status === "cancelled") return "Was stopped.";
  return null;
}

/**
 * Resolve an alert from the same persisted state that drives the sidebar's
 * unread dot. Running follow-up turns and foreground chats must stay silent.
 */
export function taskCompletionNotification(state: TaskCompletionState, threadId: string): TaskCompletionNotification | null {
  const thread = state.threads.find((candidate) => candidate.id === threadId);
  if (!thread?.unread || state.selectedThreadId === threadId) return null;
  const body = completionBody(thread.status);
  if (!body) return null;
  return { title: thread.title || "Chat", body, threadId };
}
