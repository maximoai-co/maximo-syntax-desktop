import { memo, useCallback, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { Check, Copy, WrapText } from "lucide-react";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import go from "highlight.js/lib/languages/go";
import graphql from "highlight.js/lib/languages/graphql";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import markdown from "highlight.js/lib/languages/markdown";
import php from "highlight.js/lib/languages/php";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import scss from "highlight.js/lib/languages/scss";
import shell from "highlight.js/lib/languages/shell";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

export interface MarkdownCodeBlockProps {
  code: string;
  language?: string;
  streaming?: boolean;
}

const LANGUAGE_LABELS: Record<string, string> = {
  js: "JavaScript",
  jsx: "JSX",
  ts: "TypeScript",
  tsx: "TSX",
  py: "Python",
  python: "Python",
  rb: "Ruby",
  rs: "Rust",
  go: "Go",
  java: "Java",
  kt: "Kotlin",
  kotlin: "Kotlin",
  swift: "Swift",
  c: "C",
  cpp: "C++",
  cs: "C#",
  csharp: "C#",
  php: "PHP",
  sh: "Shell",
  bash: "Bash",
  zsh: "Zsh",
  shell: "Shell",
  json: "JSON",
  yaml: "YAML",
  yml: "YAML",
  toml: "TOML",
  md: "Markdown",
  markdown: "Markdown",
  html: "HTML",
  xml: "XML",
  css: "CSS",
  scss: "SCSS",
  sql: "SQL",
  graphql: "GraphQL",
  dockerfile: "Dockerfile",
  docker: "Dockerfile",
  diff: "Diff",
  text: "Text",
  txt: "Text",
  vue: "Vue",
  svelte: "Svelte",
};

/** Map fence language ids → highlight.js language names we registered. */
const HLJS_LANGUAGE: Record<string, string> = {
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  javascript: "javascript",
  ts: "typescript",
  tsx: "typescript",
  typescript: "typescript",
  py: "python",
  python: "python",
  rb: "ruby",
  ruby: "ruby",
  rs: "rust",
  rust: "rust",
  go: "go",
  golang: "go",
  java: "java",
  kt: "kotlin",
  kotlin: "kotlin",
  swift: "swift",
  c: "c",
  cpp: "cpp",
  "c++": "cpp",
  cs: "csharp",
  csharp: "csharp",
  php: "php",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  shell: "shell",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "ini",
  md: "markdown",
  markdown: "markdown",
  html: "xml",
  xml: "xml",
  svg: "xml",
  vue: "xml",
  svelte: "xml",
  css: "css",
  scss: "scss",
  sql: "sql",
  graphql: "graphql",
  gql: "graphql",
  dockerfile: "dockerfile",
  docker: "dockerfile",
  diff: "diff",
  patch: "diff",
};

let languagesRegistered = false;

function ensureLanguages(): void {
  if (languagesRegistered) return;
  languagesRegistered = true;
  hljs.registerLanguage("bash", bash);
  hljs.registerLanguage("c", c);
  hljs.registerLanguage("cpp", cpp);
  hljs.registerLanguage("csharp", csharp);
  hljs.registerLanguage("css", css);
  hljs.registerLanguage("diff", diff);
  hljs.registerLanguage("dockerfile", dockerfile);
  hljs.registerLanguage("go", go);
  hljs.registerLanguage("graphql", graphql);
  hljs.registerLanguage("ini", ini);
  hljs.registerLanguage("java", java);
  hljs.registerLanguage("javascript", javascript);
  hljs.registerLanguage("json", json);
  hljs.registerLanguage("kotlin", kotlin);
  hljs.registerLanguage("markdown", markdown);
  hljs.registerLanguage("php", php);
  hljs.registerLanguage("python", python);
  hljs.registerLanguage("ruby", ruby);
  hljs.registerLanguage("rust", rust);
  hljs.registerLanguage("scss", scss);
  hljs.registerLanguage("shell", shell);
  hljs.registerLanguage("sql", sql);
  hljs.registerLanguage("swift", swift);
  hljs.registerLanguage("typescript", typescript);
  hljs.registerLanguage("xml", xml);
  hljs.registerLanguage("yaml", yaml);
}

export function formatLanguageLabel(language?: string): string {
  if (!language?.trim()) return "Code";
  const key = language.trim().toLowerCase();
  return LANGUAGE_LABELS[key] ?? language.trim();
}

export function resolveHljsLanguage(language?: string): string | undefined {
  if (!language?.trim()) return undefined;
  const key = language.trim().toLowerCase();
  return HLJS_LANGUAGE[key] ?? (hljs.getLanguage(key) ? key : undefined);
}

/** Highlight code to HTML; falls back to escaped plain text. */
export function highlightCode(code: string, language?: string): { html: string; language?: string } {
  ensureLanguages();
  const resolved = resolveHljsLanguage(language);
  if (resolved) {
    try {
      return { html: hljs.highlight(code, { language: resolved, ignoreIllegals: true }).value, language: resolved };
    } catch {
      /* fall through */
    }
  }
  try {
    const auto = hljs.highlightAuto(code, Object.values(HLJS_LANGUAGE));
    if (auto.relevance > 3) return { html: auto.value, language: auto.language };
  } catch {
    /* fall through */
  }
  return { html: escapeHtml(code) };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function copyCode(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    try {
      const helper = document.createElement("textarea");
      helper.value = value;
      helper.setAttribute("readonly", "");
      helper.style.position = "fixed";
      helper.style.opacity = "0";
      helper.style.pointerEvents = "none";
      document.body.appendChild(helper);
      helper.select();
      const ok = document.execCommand("copy");
      helper.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/**
 * Modern chat code block: syntax colors, language chip, hover copy + wrap/unwrap.
 * Copies the raw fence body only (no chrome, no language label).
 */
function MarkdownCodeBlock({ code, language, streaming = false }: MarkdownCodeBlockProps) {
  // Default unwrapped (horizontal scroll) so Wrap is an intentional, visible toggle.
  const [wrapped, setWrapped] = useState(false);
  const [copied, setCopied] = useState(false);
  const label = useMemo(() => formatLanguageLabel(language), [language]);
  const lineCount = useMemo(() => (code.length ? code.split("\n").length : 0), [code]);
  // Keep the real-time Markdown code-block shell, but avoid repeatedly running
  // highlight.js over a growing, incomplete fence. The persisted final answer
  // receives full syntax highlighting once the stream settles.
  const highlighted = useMemo(
    () => streaming ? { html: escapeHtml(code), language: resolveHljsLanguage(language) } : highlightCode(code, language),
    [code, language, streaming],
  );

  const onCopy = useCallback(async () => {
    const ok = await copyCode(code);
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  }, [code]);

  const toggleWrap = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setWrapped((value) => !value);
  }, []);

  return (
    <div className={`md-code-block ${wrapped ? "is-wrapped" : "is-scroll"}`} data-wrap={wrapped ? "on" : "off"}>
      <div className="md-code-toolbar">
        <div className="md-code-meta">
          <span className="md-code-lang">{label}</span>
          {lineCount > 1 && <span className="md-code-lines">{lineCount} lines</span>}
        </div>
        <div className="md-code-actions">
          <button
            type="button"
            className={`md-code-action ${wrapped ? "is-active" : ""}`}
            onClick={toggleWrap}
            title={wrapped ? "Scroll long lines (unwrap)" : "Wrap long lines"}
            aria-label={wrapped ? "Unwrap lines" : "Wrap lines"}
            aria-pressed={wrapped}
          >
            <WrapText size={13} />
            <span>{wrapped ? "Unwrap" : "Wrap"}</span>
          </button>
          <button
            type="button"
            className={`md-code-action ${copied ? "is-copied" : ""}`}
            onClick={() => void onCopy()}
            title={copied ? "Copied" : "Copy code"}
            aria-label={copied ? "Copied" : "Copy code"}
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            <span>{copied ? "Copied" : "Copy"}</span>
          </button>
        </div>
      </div>
      <pre className="md-code-pre">
        <code
          className={`hljs${highlighted.language ? ` language-${highlighted.language}` : language ? ` language-${language}` : ""}`}
          dangerouslySetInnerHTML={{ __html: highlighted.html }}
        />
      </pre>
    </div>
  );
}

export default memo(MarkdownCodeBlock);

/** Pull plain text out of react-markdown code children (usually a string). */
export function codeChildrenToText(children: ReactNode): string {
  if (children == null || typeof children === "boolean") return "";
  if (typeof children === "string" || typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(codeChildrenToText).join("");
  if (typeof children === "object" && "props" in children) {
    const element = children as { props?: { children?: ReactNode } };
    return codeChildrenToText(element.props?.children);
  }
  return "";
}
