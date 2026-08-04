import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { AppUpdateState, BrowserState, DesktopApi, RunEvent, TerminalEvent } from "./types.js";

const api: DesktopApi = {
  appInfo: () => ipcRenderer.invoke("app:info"),
  getUpdateState: () => ipcRenderer.invoke("update:state"),
  checkForUpdates: () => ipcRenderer.invoke("update:check"),
  openUpdateDownload: () => ipcRenderer.invoke("update:open-download"),
  onUpdateState: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, value: AppUpdateState) => callback(value);
    ipcRenderer.on("update:state", listener);
    return () => ipcRenderer.removeListener("update:state", listener);
  },
  loadWhatsNew: () => ipcRenderer.invoke("whats-new:load"),
  markWhatsNewSeen: (version) => ipcRenderer.invoke("whats-new:mark-seen", version),
  loadState: () => ipcRenderer.invoke("state:load"),
  listSkills: (projectPath) => ipcRenderer.invoke("skills:list", projectPath),
  completeOnboarding: () => ipcRenderer.invoke("onboarding:complete"),
  updateSettings: (patch) => ipcRenderer.invoke("settings:update", patch),
  resetProviderSelections: () => ipcRenderer.invoke("provider:reset-selections"),
  createSpace: (name, icon) => ipcRenderer.invoke("space:create", name, icon),
  selectSpace: (spaceId) => ipcRenderer.invoke("space:select", spaceId),
  chooseProject: () => ipcRenderer.invoke("project:choose"),
  chooseProjectSources: () => ipcRenderer.invoke("project:choose-sources"),
  createProject: (name, sourcePaths, spaceId) => ipcRenderer.invoke("project:create", name, sourcePaths, spaceId),
  addProject: (path) => ipcRenderer.invoke("project:add", path),
  selectProject: (projectId) => ipcRenderer.invoke("project:select", projectId),
  renameProject: (projectId, name) => ipcRenderer.invoke("project:rename", projectId, name),
  toggleProjectPinned: (projectId) => ipcRenderer.invoke("project:toggle-pinned", projectId),
  reorderProjects: (sourceProjectId, targetProjectId) => ipcRenderer.invoke("project:reorder", sourceProjectId, targetProjectId),
  archiveProjectThreads: (projectId) => ipcRenderer.invoke("project:archive-chats", projectId),
  archiveThread: (threadId) => ipcRenderer.invoke("thread:archive", threadId),
  unarchiveThread: (threadId) => ipcRenderer.invoke("thread:unarchive", threadId),
  removeProject: (projectId) => ipcRenderer.invoke("project:remove", projectId),
  createThread: (projectId) => ipcRenderer.invoke("thread:create", projectId),
  selectThread: (threadId) => ipcRenderer.invoke("thread:select", threadId),
  markThreadRead: (threadId) => ipcRenderer.invoke("thread:mark-read", threadId),
  markAllNotificationsRead: () => ipcRenderer.invoke("thread:mark-all-read"),
  renameThread: (threadId, title) => ipcRenderer.invoke("thread:rename", threadId, title),
  toggleThreadPinned: (threadId) => ipcRenderer.invoke("thread:toggle-pinned", threadId),
  toggleMessagePinned: (threadId, messageId) => ipcRenderer.invoke("thread:message-toggle-pinned", threadId, messageId),
  setMessagePinDone: (threadId, messageId, done) => ipcRenderer.invoke("thread:message-pin-done", threadId, messageId, done),
  setMessagePinLabel: (threadId, messageId, label) => ipcRenderer.invoke("thread:message-pin-label", threadId, messageId, label),
  removeMessagePin: (threadId, messageId) => ipcRenderer.invoke("thread:message-remove-pin", threadId, messageId),
  toggleThreadMarker: (threadId, messageId) => ipcRenderer.invoke("thread:marker-toggle", threadId, messageId),
  setThreadMarkerDone: (threadId, markerId, done) => ipcRenderer.invoke("thread:marker-done", threadId, markerId, done),
  setThreadMarkerLabel: (threadId, markerId, label) => ipcRenderer.invoke("thread:marker-label", threadId, markerId, label),
  removeThreadMarker: (threadId, markerId) => ipcRenderer.invoke("thread:marker-remove", threadId, markerId),
  updateThreadNotes: (threadId, notes) => ipcRenderer.invoke("thread:notes-update", threadId, notes),
  deleteThread: (threadId) => ipcRenderer.invoke("thread:delete", threadId),
  recordQuestionInteraction: (threadId, questions, toolUseId) => ipcRenderer.invoke("thread:record-question", threadId, questions, toolUseId),
  recordPermissionInteraction: (threadId, interaction) => ipcRenderer.invoke("thread:record-permission", threadId, interaction),
  chooseAttachments: () => ipcRenderer.invoke("attachments:choose"),
  attachmentFromPath: (path) => ipcRenderer.invoke("attachments:path", path),
  savePastedAttachment: (name, bytes) => ipcRenderer.invoke("attachments:save", name, bytes),
  previewAttachment: (path, thumbnail) => ipcRenderer.invoke("attachments:preview", path, thumbnail),
  filePath: (file) => webUtils.getPathForFile(file as Parameters<typeof webUtils.getPathForFile>[0]),
  ensureEngine: (forceRepair) => ipcRenderer.invoke("engine:ensure", forceRepair),
  engineStatus: () => ipcRenderer.invoke("engine:status"),
  updateEngine: () => ipcRenderer.invoke("engine:update"),
  engineModels: () => ipcRenderer.invoke("engine:models"),
  accountStatus: () => ipcRenderer.invoke("account:status"),
  accountLogin: (method, apiKey, openCodePlan) => ipcRenderer.invoke("account:login", method, apiKey, openCodePlan),
  accountCancelLogin: () => ipcRenderer.invoke("account:cancel-login"),
  accountLogout: () => ipcRenderer.invoke("account:logout"),
  accountUsage: () => ipcRenderer.invoke("account:usage"),
  notifications: {
    isSupported: () => ipcRenderer.invoke("notifications:supported"),
    show: (input) => ipcRenderer.invoke("notifications:show", input),
    playSound: () => ipcRenderer.invoke("notifications:sound"),
    onOpenThread: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, threadId: unknown) => {
        if (typeof threadId === "string" && threadId.trim()) callback(threadId);
      };
      ipcRenderer.on("notification:open-thread", listener);
      return () => ipcRenderer.removeListener("notification:open-thread", listener);
    },
  },
  startRun: (request) => ipcRenderer.invoke("run:start", request),
  sendToRun: (request) => ipcRenderer.invoke("run:send", request),
  contextUsage: (threadId) => ipcRenderer.invoke("run:context", threadId),
  respondToPermission: (threadId, response) => ipcRenderer.invoke("run:permission-response", threadId, response),
  stopRun: (threadId) => ipcRenderer.invoke("run:stop", threadId),
  gitStatus: (projectId) => ipcRenderer.invoke("git:status", projectId),
  gitBranches: (projectId) => ipcRenderer.invoke("git:branches", projectId),
  gitCheckout: (projectId, branch) => ipcRenderer.invoke("git:checkout", projectId, branch),
  gitCreateBranch: (projectId, branch) => ipcRenderer.invoke("git:create-branch", projectId, branch),
  gitDiff: (projectId, path) => ipcRenderer.invoke("git:diff", projectId, path),
  gitStage: (projectId, paths) => ipcRenderer.invoke("git:stage", projectId, paths),
  gitUnstage: (projectId, paths) => ipcRenderer.invoke("git:unstage", projectId, paths),
  gitCommitPush: (projectId, message) => ipcRenderer.invoke("git:commit-push", projectId, message),
  gitRemote: (projectId) => ipcRenderer.invoke("git:remote", projectId),
  listWorkspaceFiles: (projectId, relativePath, query) => ipcRenderer.invoke("files:list", projectId, relativePath, query),
  readWorkspaceFile: (projectId, relativePath) => ipcRenderer.invoke("files:read", projectId, relativePath),
  writeWorkspaceFile: (projectId, relativePath, content, expectedModifiedAt) => ipcRenderer.invoke("files:write", projectId, relativePath, content, expectedModifiedAt),
  listLocalServers: () => ipcRenderer.invoke("servers:list"),
  terminalStart: (projectId) => ipcRenderer.invoke("terminal:start", projectId),
  terminalInput: (sessionId, input) => ipcRenderer.invoke("terminal:input", sessionId, input),
  terminalResize: (sessionId, columns, rows) => ipcRenderer.invoke("terminal:resize", sessionId, columns, rows),
  terminalStop: (sessionId) => ipcRenderer.invoke("terminal:stop", sessionId),
  revealPath: (path) => ipcRenderer.invoke("path:reveal", path),
  openPath: (path) => ipcRenderer.invoke("path:open", path),
  openInEditor: (path) => ipcRenderer.invoke("path:editor", path),
  browser: {
    open: (input) => ipcRenderer.invoke("browser:open", input),
    close: (input) => ipcRenderer.invoke("browser:close", input),
    hide: (input) => ipcRenderer.invoke("browser:hide", input),
    getState: (input) => ipcRenderer.invoke("browser:get-state", input),
    setPanelBounds: async (input) => { ipcRenderer.send("browser:set-bounds", input); },
    navigate: (input) => ipcRenderer.invoke("browser:navigate", input),
    reload: (input) => ipcRenderer.invoke("browser:reload", input),
    goBack: (input) => ipcRenderer.invoke("browser:back", input),
    goForward: (input) => ipcRenderer.invoke("browser:forward", input),
    newTab: (input) => ipcRenderer.invoke("browser:new-tab", input),
    closeTab: (input) => ipcRenderer.invoke("browser:close-tab", input),
    selectTab: (input) => ipcRenderer.invoke("browser:select-tab", input),
    captureScreenshot: (input) => ipcRenderer.invoke("browser:screenshot", input),
    copyScreenshotToClipboard: (input) => ipcRenderer.invoke("browser:copy-screenshot", input),
    copyLink: (input) => ipcRenderer.invoke("browser:copy-link", input),
    openDevTools: (input) => ipcRenderer.invoke("browser:devtools", input),
    onState: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, value: BrowserState) => callback(value);
      ipcRenderer.on("browser:state", listener);
      return () => ipcRenderer.removeListener("browser:state", listener);
    },
    onOpenPanelRequest: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, value: { threadId?: unknown }) => {
        if (typeof value?.threadId === "string" && value.threadId.trim()) callback({ threadId: value.threadId });
      };
      ipcRenderer.on("browser:open-panel-request", listener);
      return () => ipcRenderer.removeListener("browser:open-panel-request", listener);
    },
    onCopyLink: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, value: { threadId?: unknown; url?: unknown }) => {
        if (typeof value?.threadId === "string" && typeof value?.url === "string") callback({ threadId: value.threadId, url: value.url });
      };
      ipcRenderer.on("browser:copy-link", listener);
      return () => ipcRenderer.removeListener("browser:copy-link", listener);
    },
  },
  onRunEvent: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, value: RunEvent | RunEvent[]) => {
      if (Array.isArray(value)) {
        for (const event of value) callback(event);
      } else {
        callback(value);
      }
    };
    ipcRenderer.on("run:event", listener);
    return () => ipcRenderer.removeListener("run:event", listener);
  },
  onTerminalEvent: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, value: TerminalEvent) => callback(value);
    ipcRenderer.on("terminal:event", listener);
    return () => ipcRenderer.removeListener("terminal:event", listener);
  },
  onMenuAction: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, value: string) => callback(value);
    ipcRenderer.on("menu:action", listener);
    return () => ipcRenderer.removeListener("menu:action", listener);
  },
};

contextBridge.exposeInMainWorld("maximoDesktop", api);
