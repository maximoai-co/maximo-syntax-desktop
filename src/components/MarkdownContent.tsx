import { Children, isValidElement, memo, type ComponentPropsWithoutRef, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import MarkdownCodeBlock, { codeChildrenToText } from "./MarkdownCodeBlock";

interface MarkdownContentProps {
  children: string;
  className?: string;
}

type PreProps = ComponentPropsWithoutRef<"pre"> & {
  node?: unknown;
};

type TableProps = ComponentPropsWithoutRef<"table"> & {
  node?: unknown;
};

function extractLanguage(className?: string): string | undefined {
  if (!className) return undefined;
  const match = /(?:^|\s)language-([A-Za-z0-9_+#.-]+)/.exec(className);
  return match?.[1];
}

/**
 * Fenced blocks are always `pre > code`. We replace that shell with the
 * modern chat code-block UI. Inline `code` keeps the default renderer + CSS.
 */
function MarkdownPre({ children }: PreProps) {
  const items = Children.toArray(children);
  const only = items.length === 1 ? items[0] : null;
  if (isValidElement(only)) {
    const props = only.props as { className?: string; children?: ReactNode };
    const className = typeof props.className === "string" ? props.className : undefined;
    const language = extractLanguage(className);
    const code = codeChildrenToText(props.children).replace(/\n$/, "");
    return <MarkdownCodeBlock code={code} language={language} />;
  }
  // Unusual pre content — keep a safe native shell.
  return <pre className="md-code-fallback">{children}</pre>;
}

/** Scroll wide GFM tables inside the message instead of expanding the chat column. */
function MarkdownTable({ children, node: _node, ...props }: TableProps) {
  return (
    <div className="table-wrap">
      <table {...props}>{children}</table>
    </div>
  );
}

const markdownComponents = {
  pre: MarkdownPre,
  table: MarkdownTable,
};

/**
 * Shared chat markdown renderer with modern fenced code blocks
 * (copy, wrap/unwrap, language header) used across message + live stream views.
 */
function MarkdownContent({ children, className }: MarkdownContentProps) {
  const content = children ?? "";
  return (
    <div className={className ? `markdown ${className}` : "markdown"}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {content}
      </ReactMarkdown>
    </div>
  );
}

// Transcript updates are frequent while a run is active. Completed markdown is
// immutable, so avoid reparsing it when a sibling status or disclosure changes.
export default memo(MarkdownContent);
