import { Children, isValidElement, memo, useDeferredValue, type ComponentPropsWithoutRef, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import MarkdownCodeBlock, { codeChildrenToText } from "./MarkdownCodeBlock";
import MarkdownImage from "./MarkdownImage";

interface MarkdownContentProps {
  children: string;
  className?: string;
  streaming?: boolean;
}

type PreProps = ComponentPropsWithoutRef<"pre"> & {
  node?: unknown;
  streaming?: boolean;
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
function MarkdownPre({ children, streaming = false }: PreProps) {
  const items = Children.toArray(children);
  const only = items.length === 1 ? items[0] : null;
  if (isValidElement(only)) {
    const props = only.props as { className?: string; children?: ReactNode };
    const className = typeof props.className === "string" ? props.className : undefined;
    const language = extractLanguage(className);
    const code = codeChildrenToText(props.children).replace(/\n$/, "");
    return <MarkdownCodeBlock code={code} language={language} streaming={streaming} />;
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

type ImgProps = ComponentPropsWithoutRef<"img"> & { node?: unknown };

function MarkdownImg({ src, alt, title }: ImgProps) {
  if (!src || typeof src !== "string") return null;
  // Keep local assets / data: as native img (no card)
  const isRemoteGenerated = /^https?:\/\//i.test(src);
  if (!isRemoteGenerated) return <img src={src} alt={alt || ""} title={title} loading="lazy" decoding="async" />;
  return <MarkdownImage src={src} alt={alt} title={title} />;
}

const markdownComponents = {
  pre: MarkdownPre,
  table: MarkdownTable,
  img: MarkdownImg,
};

function StreamingMarkdownPre(props: PreProps) {
  return <MarkdownPre {...props} streaming />;
}

const streamingMarkdownComponents = {
  ...markdownComponents,
  pre: StreamingMarkdownPre,
};

/**
 * Shared chat markdown renderer with modern fenced code blocks
 * (copy, wrap/unwrap, language header) used across message + live stream views.
 */
function MarkdownContent({ children, className, streaming = false }: MarkdownContentProps) {
  const content = children ?? "";
  // Keep Markdown fully formatted during a stream. The deferred value lets
  // React interrupt an older Markdown render when input, scrolling, or a newer
  // stream snapshot arrives; upstream stream coalescing prevents this subtree
  // from receiving updates while the user is actively interacting.
  const deferredContent = useDeferredValue(content);
  const renderedContent = streaming ? deferredContent : content;
  return (
    <div className={className ? `markdown ${className}` : "markdown"}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={streaming ? streamingMarkdownComponents : markdownComponents}>
        {renderedContent}
      </ReactMarkdown>
    </div>
  );
}

// Transcript updates are frequent while a run is active. Completed markdown is
// immutable, so avoid reparsing it when a sibling status or disclosure changes.
// Memoization is keyed strictly on content + className to keep thread switching smooth
// when parent re-renders with new thread identity but same markdown.
export default memo(MarkdownContent, (prev, next) => prev.children === next.children && prev.className === next.className && prev.streaming === next.streaming);
