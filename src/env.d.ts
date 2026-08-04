import type { DesktopApi } from "../desktop/types";

declare global {
  interface Window {
    maximoDesktop: DesktopApi;
  }
}

export {};
