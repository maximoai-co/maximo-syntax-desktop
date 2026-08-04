import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { SlashCommand } from "./types.js";

/**
 * Skill discovery for the desktop "/" menu, mirroring the CLI's skill roots
 * (see maximo-syntax-cli/src/skills/skillCompatibility.ts). The CLI engine's
 * system/init only reports its bundled skills, so the desktop reads the same
 * on-disk catalog the CLI's `/skills list` picker shows: user-level roots
 * (`~/.grok/skills`, `~/.codex/skills`, ...) plus project-level roots.
 */

const USER_PROVIDER_ROOTS: ReadonlyArray<{ relativePath: string; label: string }> = [
  { relativePath: "skills", label: "Maximo" },
  { relativePath: ".agents/skills", label: "Agent Skills" },
  { relativePath: ".codex/skills", label: "Codex CLI" },
  { relativePath: ".claude/skills", label: "Claude Code" },
  { relativePath: ".gemini/skills", label: "Gemini CLI" },
  { relativePath: ".grok/skills", label: "Grok CLI" },
  { relativePath: ".config/opencode/skills", label: "OpenCode" },
];

const PROJECT_PROVIDER_ROOTS: ReadonlyArray<{ relativePath: string; label: string }> = [
  { relativePath: ".maximo/skills", label: "Maximo" },
  { relativePath: ".agents/skills", label: "Agent Skills" },
  { relativePath: ".claude/skills", label: "Claude Code" },
  { relativePath: ".gemini/skills", label: "Gemini CLI" },
  { relativePath: ".grok/skills", label: "Grok CLI" },
  { relativePath: ".opencode/skills", label: "OpenCode" },
];

const MAX_SKILL_DEPTH = 2;
const MAX_SKILL_COUNT = 200;

/** Parse `key: value` / `key: >` (folded) YAML frontmatter lines. */
function parseFrontmatter(content: string): { name?: string; description?: string; argumentHint?: string } {
  const trimmed = content.replace(/^\uFEFF/, "");
  const match = /^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/.exec(trimmed);
  if (!match) return {};
  const block = match[1] ?? "";
  const fields: Record<string, string | undefined> = {};
  const lines = block.split("\n");
  let currentKey: string | null = null;
  const collected: string[] = [];

  const flush = () => {
    if (currentKey !== null && collected.length > 0) {
      let value = collected.join("\n").trim();
      if (value.startsWith(">")) value = value.slice(1).trim();
      if (value.startsWith("|")) value = value.slice(1).replace(/\n$/, "");
      fields[currentKey] = value.trim();
    }
    collected.length = 0;
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const keyMatch = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (keyMatch) {
      flush();
      currentKey = keyMatch[1];
      const rest = keyMatch[2] ?? "";
      if (rest.trim().length > 0 && !rest.trim().startsWith(">") && !rest.trim().startsWith("|")) {
        fields[currentKey] = rest.trim();
        currentKey = null;
      } else if (rest.trim().startsWith(">") || rest.trim().startsWith("|")) {
        collected.push(rest.trim());
      }
    } else if (currentKey !== null && (line.startsWith("  ") || line.startsWith("\t") || /^\s+/.test(line))) {
      collected.push(line.trim());
    } else {
      flush();
      currentKey = null;
    }
  }
  flush();

  const description = fields.description?.replace(/^["']|["']$/g, "");
  return {
    name: fields.name?.replace(/^["']|["']$/g, ""),
    description: description ? description.replace(/\s+/g, " ").trim() : undefined,
    argumentHint: fields["argument-hint"]?.replace(/^["']|["']$/g, ""),
  };
}

async function loadSkillFromDirectory(skillDir: string): Promise<SlashCommand | null> {
  try {
    const content = await readFile(join(skillDir, "SKILL.md"), "utf8");
    const parsed = parseFrontmatter(content);
    const folderName = skillDir.split("/").filter(Boolean).pop() ?? "";
    const name = (parsed.name ?? folderName).replace(/^\//, "").trim();
    if (!name) return null;
    return { name, description: parsed.description, ...(parsed.argumentHint ? { argumentHint: parsed.argumentHint } : {}) };
  } catch {
    return null;
  }
}

async function loadSkillsFromRoot(root: string, depth: number, result: SlashCommand[]): Promise<void> {
  if (depth > MAX_SKILL_DEPTH || result.length >= MAX_SKILL_COUNT) return;
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (result.length >= MAX_SKILL_COUNT) return;
    const fullPath = join(root, entry.name);
    if (entry.isDirectory()) {
      const hasSkill = await loadSkillFromDirectory(fullPath);
      if (hasSkill) {
        result.push(hasSkill);
      } else {
        await loadSkillsFromRoot(fullPath, depth + 1, result);
      }
    }
  }
}

async function loadSkillsFromBase(base: string, roots: ReadonlyArray<{ relativePath: string; label: string }>): Promise<SlashCommand[]> {
  const result: SlashCommand[] = [];
  for (const root of roots) {
    if (result.length >= MAX_SKILL_COUNT) break;
    await loadSkillsFromRoot(join(base, root.relativePath), 0, result);
  }
  return result;
}

export async function discoverSkills(
  projectPath?: string | null,
  overrides?: { home?: string; project?: string },
): Promise<SlashCommand[]> {
  const home = overrides?.home ?? homedir();
  const resolvedProject = overrides?.project ?? projectPath;
  const discovered: SlashCommand[] = [];
  discovered.push(...(await loadSkillsFromBase(home, USER_PROVIDER_ROOTS)));
  if (resolvedProject) {
    discovered.push(...(await loadSkillsFromBase(resolvedProject, PROJECT_PROVIDER_ROOTS)));
  }
  // First-wins by name — precedence matches the CLI (user roots, then project).
  const seen = new Set<string>();
  const unique: SlashCommand[] = [];
  for (const skill of discovered) {
    const key = skill.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(skill);
  }
  return unique;
}
