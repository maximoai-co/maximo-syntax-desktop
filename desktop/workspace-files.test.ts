import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listWorkspaceFiles, readWorkspaceFile, writeWorkspaceFile } from "./workspace-files.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("workspace file service", () => {
  it("lists directories, hides generated folders, and searches recursively", async () => {
    const root = await mkdtemp(join(tmpdir(), "maximo-workspace-files-"));
    temporaryDirectories.push(root);
    await mkdir(join(root, "src", "nested"), { recursive: true });
    await mkdir(join(root, "node_modules", "ignored"), { recursive: true });
    await writeFile(join(root, "README.md"), "# Maximo\n");
    await writeFile(join(root, "src", "nested", "feature.ts"), "export const feature = true;\n");
    await writeFile(join(root, "node_modules", "ignored", "package.js"), "ignored\n");

    const entries = await listWorkspaceFiles(root);
    expect(entries.map((entry) => entry.name)).toEqual(["src", "README.md"]);
    const matches = await listWorkspaceFiles(root, "", "feature");
    expect(matches.map((entry) => entry.path)).toEqual(["src/nested/feature.ts"]);
  });

  it("ranks exact and fuzzy path matches before broader matches", async () => {
    const root = await mkdtemp(join(tmpdir(), "maximo-workspace-files-"));
    temporaryDirectories.push(root);
    await mkdir(join(root, "src", "components"), { recursive: true });
    await writeFile(join(root, "src", "components", "SearchPalette.tsx"), "export {}\n");
    await writeFile(join(root, "src", "components", "Sidebar.tsx"), "export {}\n");
    await writeFile(join(root, "docs-search.md"), "search\n");

    const matches = await listWorkspaceFiles(root, "", "SearchPalette");
    expect(matches[0]?.path).toBe("src/components/SearchPalette.tsx");
    const fuzzyMatches = await listWorkspaceFiles(root, "", "sbr");
    expect(fuzzyMatches[0]?.path).toBe("src/components/Sidebar.tsx");
  });

  it("reads and safely writes text files with an optimistic timestamp check", async () => {
    const root = await mkdtemp(join(tmpdir(), "maximo-workspace-files-"));
    temporaryDirectories.push(root);
    await writeFile(join(root, "notes.md"), "before\n");
    const original = await readWorkspaceFile(root, "notes.md");
    const updated = await writeWorkspaceFile(root, "notes.md", "after\n", original.modifiedAt);
    expect(updated.content).toBe("after\n");
    expect(await readFile(join(root, "notes.md"), "utf8")).toBe("after\n");
    await expect(writeWorkspaceFile(root, "notes.md", "conflict\n", original.modifiedAt - 1_000)).rejects.toThrow("changed outside");
  });

  it("rejects traversal outside the registered project root", async () => {
    const root = await mkdtemp(join(tmpdir(), "maximo-workspace-files-"));
    temporaryDirectories.push(root);
    await expect(listWorkspaceFiles(root, "../outside")).rejects.toThrow("outside the project");
    await expect(readWorkspaceFile(root, "../../etc/passwd")).rejects.toThrow("outside the project");
  });
});
