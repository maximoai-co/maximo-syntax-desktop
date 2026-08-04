import { describe, expect, it } from "vitest";
import { codeChildrenToText, formatLanguageLabel, highlightCode, resolveHljsLanguage } from "./MarkdownCodeBlock";

describe("formatLanguageLabel", () => {
  it("maps common short language ids to friendly labels", () => {
    expect(formatLanguageLabel("ts")).toBe("TypeScript");
    expect(formatLanguageLabel("tsx")).toBe("TSX");
    expect(formatLanguageLabel("bash")).toBe("Bash");
    expect(formatLanguageLabel("json")).toBe("JSON");
  });

  it("falls back for unknown languages and empty values", () => {
    expect(formatLanguageLabel("zig")).toBe("zig");
    expect(formatLanguageLabel("")).toBe("Code");
    expect(formatLanguageLabel(undefined)).toBe("Code");
  });
});

describe("codeChildrenToText", () => {
  it("flattens nested children into raw code text", () => {
    expect(codeChildrenToText("const x = 1;\n")).toBe("const x = 1;\n");
    expect(codeChildrenToText(["a", "b", 3])).toBe("ab3");
    expect(codeChildrenToText(null)).toBe("");
  });
});

describe("highlightCode", () => {
  it("resolves fence aliases to highlight.js languages", () => {
    expect(resolveHljsLanguage("ts")).toBe("typescript");
    expect(resolveHljsLanguage("tsx")).toBe("typescript");
    expect(resolveHljsLanguage("py")).toBe("python");
    expect(resolveHljsLanguage("sh")).toBe("bash");
  });

  it("emits token spans for TypeScript and escapes plain fallback", () => {
    const ts = highlightCode("const answer: number = 42;", "ts");
    expect(ts.language).toBe("typescript");
    expect(ts.html).toContain("hljs-");
    expect(ts.html).toContain("42");

    const plain = highlightCode("<script>alert(1)</script>", "not-a-real-lang-xyz");
    expect(plain.html).toContain("&lt;script&gt;");
    expect(plain.html).not.toContain("<script>");
  });
});
