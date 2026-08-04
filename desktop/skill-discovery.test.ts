import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { discoverSkills } from "./skill-discovery.js";

function makeSkillDir(root: string, provider: string, name: string, frontmatter: string): string {
  const dir = join(root, provider, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), frontmatter);
  return dir;
}

describe("discoverSkills", () => {
  it("finds skills in user roots with parsed frontmatter", async () => {
    const root = mkdtempSync(join(tmpdir(), "skills-test-"));
    makeSkillDir(root, ".grok/skills", "create-skill", `---
name: create-skill
description: >
  Interactively create a new Grok skill.
  Use when the user wants to scaffold a skill.
---

# Create Skill
`);
    makeSkillDir(root, ".codex/skills", "maximoai-sql", `---
name: maximoai-sql
description: Safely inspect the production Cloud SQL database.
---

# MaximoAI SQL
`);
    const skills = await discoverSkills(undefined, { home: root });
    expect(skills.length).toBe(2);
    const create = skills.find((s) => s.name === "create-skill")!;
    expect(create.description).toContain("Interactively create a new Grok skill");
    expect(create.description).toContain("scaffold a skill");
    expect(skills.find((s) => s.name === "maximoai-sql")!.description).toContain("Cloud SQL");
  });

  it("falls back to the folder name when frontmatter has no name", async () => {
    const root = mkdtempSync(join(tmpdir(), "skills-test-"));
    makeSkillDir(root, ".agents/skills", "my-skill", `---
description: A skill without a name field.
---

# My Skill
`);
    const skills = await discoverSkills(undefined, { home: root });
    const found = skills.find((s) => s.name === "my-skill");
    expect(found).toBeDefined();
    expect(found?.description).toContain("without a name field");
  });

  it("parses single-line description", async () => {
    const root = mkdtempSync(join(tmpdir(), "skills-test-"));
    makeSkillDir(root, ".claude/skills", "review", `---
name: review
description: Run a strict code review.
---

# Review
`);
    const skills = await discoverSkills(undefined, { home: root });
    expect(skills.find((s) => s.name === "review")?.description).toContain("strict code review");
  });
});
