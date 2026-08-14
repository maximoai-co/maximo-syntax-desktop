import { describe, expect, it } from "vitest";
import type { GitDiff, Project, Thread } from "../../desktop/types.js";
import { gitFilesForScope, savedTurnDiffs, savedTurnFiles } from "./diffReviewHistory.js";

const project: Project = { id: "project", name: "Project", path: "/workspace/project", createdAt: 1, lastOpenedAt: 1 };

describe("saved task diff review", () => {
  it("keeps partially staged files in both Git sources with source-specific totals", () => {
    const files = [{
      path: "src/shared.ts",
      status: "M",
      additions: 9,
      deletions: 5,
      staged: true,
      unstaged: true,
      stagedAdditions: 2,
      stagedDeletions: 1,
      unstagedAdditions: 7,
      unstagedDeletions: 4,
    }];

    expect(gitFilesForScope(files, "staged")[0]).toMatchObject({ path: "src/shared.ts", additions: 2, deletions: 1 });
    expect(gitFilesForScope(files, "unstaged")[0]).toMatchObject({ path: "src/shared.ts", additions: 7, deletions: 4 });
    expect(gitFilesForScope(files, "working-tree")[0]).toMatchObject({ path: "src/shared.ts", additions: 9, deletions: 5 });
  });

  it("keeps every file in a completed turn visible after the working tree is clean", () => {
    const firstPatch = "diff --git a/src/first.ts b/src/first.ts\n--- a/src/first.ts\n+++ b/src/first.ts\n@@ -1 +1 @@\n-old\n+new\n";
    const secondPatch = "diff --git a/src/second.ts b/src/second.ts\n--- a/src/second.ts\n+++ b/src/second.ts\n@@ -0,0 +1,2 @@\n+one\n+two\n";
    const thread: Thread = {
      id: "thread",
      projectId: project.id,
      title: "Task",
      createdAt: 1,
      updatedAt: 2,
      status: "complete",
      messages: [{
        id: "answer",
        role: "assistant",
        content: "Done",
        createdAt: 2,
        fileChanges: [
          { path: "/workspace/project/src/first.ts", patch: firstPatch, additions: 1, deletions: 1 },
          { path: "src/second.ts", patch: secondPatch, additions: 2, deletions: 0 },
        ],
      }],
    };
    const selection: GitDiff = { path: "src/first.ts", patch: firstPatch, source: "turn", turnId: "answer" };

    const diffs = savedTurnDiffs(project, thread, selection.path, selection);
    const files = savedTurnFiles(diffs);

    expect(diffs.map((diff) => diff.path)).toEqual(["src/first.ts", "src/second.ts"]);
    expect(files).toEqual([
      { path: "src/first.ts", status: "M", additions: 1, deletions: 1 },
      { path: "src/second.ts", status: "A", additions: 2, deletions: 0 },
    ]);
  });
});
