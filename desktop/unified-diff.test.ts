import { describe, expect, it } from "vitest";
import { buildUnifiedPatch, normalizeFileChange, normalizeLegacyFullReplacementPatch, patchStats } from "./unified-diff.js";

function numberedLines(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `existing line ${index + 1}`);
}

describe("large unified diffs", () => {
  it("reports a small insertion in a 5,101-line file instead of replacing the whole file", () => {
    const beforeLines = numberedLines(5_101);
    const insertedLines = Array.from({ length: 74 }, (_, index) => `new changelog line ${index + 1}`);
    const before = `${beforeLines.join("\n")}\n`;
    const after = `${[...insertedLines, ...beforeLines].join("\n")}\n`;

    const change = buildUnifiedPatch("frontend/src/lib/changelogFallbacks.ts", before, after);

    expect(change).toMatchObject({ additions: 74, deletions: 0 });
    expect(change.patch).toContain("@@ -1,4 +1,78 @@");
    expect(change.patch).toContain("+new changelog line 74");
    expect(change.patch).not.toContain("-existing line 5000");
  });

  it("repairs full-file replacement patches saved by earlier desktop releases", () => {
    const path = "frontend/src/lib/changelogFallbacks.ts";
    const beforeLines = numberedLines(5_101);
    const insertedLines = Array.from({ length: 74 }, (_, index) => `new changelog line ${index + 1}`);
    const afterLines = [...insertedLines, ...beforeLines];
    const legacyPatch = [
      `diff --git a/${path} b/${path}`,
      `--- a/${path}`,
      `+++ b/${path}`,
      `@@ -1,${beforeLines.length} +1,${afterLines.length} @@`,
      ...beforeLines.map((line) => `-${line}`),
      ...afterLines.map((line) => `+${line}`),
      "",
    ].join("\n");

    const normalizedPatch = normalizeLegacyFullReplacementPatch(legacyPatch, path);
    const normalized = normalizeFileChange({ path, patch: legacyPatch, additions: 5_175, deletions: 5_101 });

    expect(normalizedPatch.length).toBeLessThan(legacyPatch.length / 20);
    expect(patchStats(normalizedPatch)).toEqual({ additions: 74, deletions: 0 });
    expect(normalized).toMatchObject({ additions: 74, deletions: 0, patch: normalizedPatch });
  });

  it("bounds pathological rewrites without marking shared file edges as changed", () => {
    const before = ["shared first line", ...Array.from({ length: 3_000 }, (_, index) => `old line ${index}`), "shared last line"].join("\n");
    const after = ["shared first line", ...Array.from({ length: 3_000 }, (_, index) => `new line ${index}`), "shared last line"].join("\n");

    const change = buildUnifiedPatch("src/rewrite.ts", before, after);

    expect(change).toMatchObject({ additions: 3_000, deletions: 3_000 });
    expect(change.patch).toContain(" shared first line");
    expect(change.patch).toContain(" shared last line");
    expect(change.patch).not.toContain("-shared first line");
    expect(change.patch).not.toContain("+shared last line");
  });
});
