import { describe, expect, it } from "vitest";
import { activitySummaryDetail } from "./activitySummary.js";

describe("activitySummaryDetail", () => {
  it("uses a Bash tool description instead of the raw command", () => {
    expect(activitySummaryDetail({
      label: "Using Bash",
      toolName: "Bash",
      detail: "gcloud run deploy --source backend",
      data: JSON.stringify({ command: "gcloud run deploy --source backend", description: "Deploy the backend to Cloud Run" }),
    })).toBe("Deploy the backend to Cloud Run");
  });

  it("falls back to the existing detail for missing or invalid descriptions", () => {
    const item = { label: "Using Bash", toolName: "Bash", detail: "npm run build" };
    expect(activitySummaryDetail(item)).toBe("npm run build");
    expect(activitySummaryDetail({ ...item, data: "not json" })).toBe("npm run build");
    expect(activitySummaryDetail({ ...item, data: JSON.stringify({ command: "npm run build" }) })).toBe("npm run build");
  });

  it("does not treat an unrelated tool description as a command summary", () => {
    expect(activitySummaryDetail({
      label: "Using Agent",
      toolName: "Agent",
      detail: "agent-tool",
      data: JSON.stringify({ description: "Inspect the project" }),
    })).toBe("agent-tool");
  });

  it("normalizes and bounds long descriptions", () => {
    const description = `  ${"Explain this deployment step ".repeat(20)}  `;
    const summary = activitySummaryDetail({ label: "Using Bash", toolName: "Bash", data: JSON.stringify({ description }) });
    expect(summary).toHaveLength(160);
    expect(summary?.endsWith("…")).toBe(true);
    expect(summary?.includes("  ")).toBe(false);
  });
});
