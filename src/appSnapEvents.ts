import type { Attachment } from "../desktop/types";

export const APP_SNAP_ATTACH_EVENT = "maximo:appsnap-attach";

export interface AppSnapAttachDetail {
  threadId: string;
  attachment: Attachment;
}

export function dispatchAppSnapAttach(threadId: string, attachment: Attachment): void {
  window.dispatchEvent(new CustomEvent<AppSnapAttachDetail>(APP_SNAP_ATTACH_EVENT, {
    detail: { threadId, attachment },
  }));
}
